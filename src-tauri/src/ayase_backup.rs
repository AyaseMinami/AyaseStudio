//! Bounded file access for the frontend-owned backup format and import journal.
use std::{
    collections::HashSet,
    fs::{Metadata, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use uuid::{Uuid, Variant, Version};

const BACKUP_LIMIT: u64 = 128 * 1024 * 1024;
const RESOURCE_LIMIT: u64 = 48 * 1024 * 1024;
const REMOVE_LIMIT: usize = 2000;

#[derive(Debug, PartialEq, Eq)]
enum Error {
    InvalidReference,
    TooLarge,
    Corrupt,
    Unavailable,
    Storage,
}
impl Error {
    fn code(&self) -> String {
        match self {
            Self::InvalidReference => "ayase-backup-invalid-reference",
            Self::TooLarge => "ayase-backup-too-large",
            Self::Corrupt => "ayase-backup-corrupt",
            Self::Unavailable => "ayase-backup-unavailable",
            Self::Storage => "ayase-backup-storage",
        }
        .to_owned()
    }
}

struct Reference<'a> {
    background: bool,
    name: &'a str,
    extension: &'a str,
}
fn reference(value: &str) -> Result<Reference<'_>, Error> {
    let (directory, name) = value.split_once('/').ok_or(Error::InvalidReference)?;
    let background = match directory {
        "attachments" => false,
        "backgrounds" => true,
        _ => return Err(Error::InvalidReference),
    };
    let (id, extension) = name.rsplit_once('.').ok_or(Error::InvalidReference)?;
    let parsed = Uuid::parse_str(id).map_err(|_| Error::InvalidReference)?;
    if id.len() != 36
        || parsed.get_version() != Some(Version::Random)
        || parsed.get_variant() != Variant::RFC4122
        || parsed.hyphenated().to_string() != id
        || !matches!(
            extension,
            "png" | "jpg" | "webp" | "pdf" | "txt" | "md" | "docx" | "xlsx" | "pptx"
        )
        || (background && !matches!(extension, "png" | "jpg" | "webp"))
    {
        return Err(Error::InvalidReference);
    }
    Ok(Reference {
        background,
        name,
        extension,
    })
}

fn link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

// Check each ancestor, including junctions on Windows. Never canonicalize a link.
// A missing suffix is allowed for new resources and idempotent journal cleanup.
fn inspect_path(path: &Path) -> Result<Option<Metadata>, Error> {
    if !path.is_absolute() {
        return Err(Error::InvalidReference);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if !current.is_absolute() {
            continue;
        }
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if link(&metadata) || (current != path && !metadata.is_dir()) {
                    return Err(Error::InvalidReference);
                }
                if current == path {
                    return Ok(Some(metadata));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Error::Storage),
        }
    }
    Err(Error::InvalidReference)
}

fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, Error> {
    let metadata = inspect_path(path)?.ok_or(Error::Unavailable)?;
    if !metadata.is_file() {
        return Err(Error::InvalidReference);
    }
    if metadata.len() > limit {
        return Err(Error::TooLarge);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path).map_err(|_| Error::Unavailable)?;
    let metadata = file.metadata().map_err(|_| Error::Storage)?;
    if link(&metadata) || !metadata.is_file() {
        return Err(Error::InvalidReference);
    }
    if metadata.len() > limit {
        return Err(Error::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Storage)?;
    if bytes.len() as u64 > limit {
        return Err(Error::TooLarge);
    }
    Ok(bytes)
}

fn original_path(directory: &Path, item: &Reference<'_>) -> PathBuf {
    directory
        .join(if item.background {
            "backgrounds"
        } else {
            "attachments"
        })
        .join(item.name)
}

fn validate_bytes(item: &Reference<'_>, bytes: &[u8]) -> Result<(), Error> {
    if bytes.len() as u64 > RESOURCE_LIMIT {
        return Err(Error::TooLarge);
    }
    if item.background {
        if bytes.len() as u64 > crate::background::MAX_BACKGROUND_BYTES {
            return Err(Error::TooLarge);
        }
        let extension =
            crate::background::backup_image_extension(bytes).map_err(|_| Error::Corrupt)?;
        if extension != item.extension {
            return Err(Error::Corrupt);
        }
    } else {
        crate::attachments::import_mime(item.name, bytes).ok_or(Error::Corrupt)?;
    }
    Ok(())
}

fn resource_paths(directory: &Path, item: &Reference<'_>) -> Vec<PathBuf> {
    let original = original_path(directory, item);
    if item.background {
        vec![original]
    } else {
        vec![
            original,
            directory.join("attachments/staging").join(item.name),
            directory.join("attachments/quarantine").join(item.name),
        ]
    }
}

fn read_resource(directory: &Path, value: &str) -> Result<String, Error> {
    let item = reference(value)?;
    let limit = if item.background {
        crate::background::MAX_BACKGROUND_BYTES
    } else {
        RESOURCE_LIMIT
    };
    for path in resource_paths(directory, &item) {
        if inspect_path(&path)?.is_none() {
            continue;
        }
        let bytes = bounded_read(&path, limit)?;
        validate_bytes(&item, &bytes)?;
        return Ok(STANDARD.encode(bytes));
    }
    Err(Error::Unavailable)
}

fn assert_resources_available(directory: &Path, values: &[String]) -> Result<(), Error> {
    if values.len() > REMOVE_LIMIT {
        return Err(Error::TooLarge);
    }
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    // Validate all references before inspecting files. This command only checks
    // availability; the frontend's exclusive maintenance root owns reservation.
    for value in values {
        let item = reference(value)?;
        if !seen.insert(value.as_str()) {
            return Err(Error::InvalidReference);
        }
        paths.extend(resource_paths(directory, &item));
        if item.background {
            paths.push(
                directory
                    .join("backgrounds/thumbnails")
                    .join(format!("{}.png", item.name)),
            );
        }
    }
    for path in paths {
        if inspect_path(&path)?.is_some() {
            return Err(Error::Storage);
        }
    }
    Ok(())
}

fn write_resource(directory: &Path, value: &str, data: &str) -> Result<(), Error> {
    let item = reference(value)?;
    // Reject oversized encoded data before allocating its decoded copy.
    if data.len() as u64 > RESOURCE_LIMIT.div_ceil(3) * 4 {
        return Err(Error::TooLarge);
    }
    let bytes = STANDARD.decode(data).map_err(|_| Error::Corrupt)?;
    validate_bytes(&item, &bytes)?;
    for path in resource_paths(directory, &item) {
        if inspect_path(&path)?.is_some() {
            return Err(Error::Storage);
        }
    }
    let path = original_path(directory, &item);
    let parent = path.parent().ok_or(Error::Storage)?;
    std::fs::create_dir_all(parent).map_err(|_| Error::Storage)?;
    inspect_path(parent)?.ok_or(Error::Storage)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| Error::Storage)?;
    // Do not remove a partial file: the already-persisted import journal owns it.
    file.write_all(&bytes).map_err(|_| Error::Storage)?;
    file.flush().map_err(|_| Error::Storage)?;
    file.sync_all().map_err(|_| Error::Storage)
}

fn remove_resources(directory: &Path, values: &[String]) -> Result<(), Error> {
    if values.len() > REMOVE_LIMIT {
        return Err(Error::TooLarge);
    }
    let mut paths = Vec::new();
    // Validate the complete list and every existing path before any deletion.
    for value in values {
        let item = reference(value)?;
        paths.push(original_path(directory, &item));
        if item.background {
            paths.push(
                directory
                    .join("backgrounds/thumbnails")
                    .join(format!("{}.png", item.name)),
            );
        }
    }
    for path in &paths {
        if inspect_path(path)?.is_some_and(|metadata| !metadata.is_file()) {
            return Err(Error::InvalidReference);
        }
    }
    for path in paths {
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(Error::Storage),
        }
    }
    Ok(())
}

fn read_backup(path: &Path) -> Result<String, Error> {
    String::from_utf8(bounded_read(path, BACKUP_LIMIT)?).map_err(|_| Error::Corrupt)
}
fn save_backup(path: &Path, data: &str) -> Result<(), Error> {
    if data.len() as u64 > BACKUP_LIMIT {
        return Err(Error::TooLarge);
    }
    if inspect_path(path)?.is_some_and(|metadata| !metadata.is_file()) {
        return Err(Error::InvalidReference);
    }
    let parent = path.parent().ok_or(Error::Storage)?;
    if !inspect_path(parent)?.is_some_and(|metadata| metadata.is_dir()) {
        return Err(Error::Storage);
    }
    let mut output = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::Storage)?;
    output
        .write_all(data.as_bytes())
        .map_err(|_| Error::Storage)?;
    output.flush().map_err(|_| Error::Storage)?;
    output.as_file().sync_all().map_err(|_| Error::Storage)?;
    output.persist(path).map_err(|_| Error::Storage)?;
    Ok(())
}

fn app_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| Error::Storage.code())
}

#[tauri::command]
pub async fn select_ayase_backup(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Ayase Backup", &["ayase"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| Error::InvalidReference.code())?;
        read_backup(&path).map(Some).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn save_ayase_backup(app: AppHandle, data: String) -> Result<bool, String> {
    if data.len() as u64 > BACKUP_LIMIT {
        return Err(Error::TooLarge.code());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Ayase Backup", &["ayase"])
            .set_file_name("Ayase-Studio-backup.ayase")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file
            .into_path()
            .map_err(|_| Error::InvalidReference.code())?;
        save_backup(&path, &data)
            .map(|_| true)
            .map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn read_ayase_resource(app: AppHandle, reference: String) -> Result<String, String> {
    let directory = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let item = self::reference(&reference).map_err(|error| error.code())?;
        let mutex = if item.background {
            &crate::background::BACKGROUND_FILES
        } else {
            &crate::attachments::FILE_OPERATIONS
        };
        let _guard = mutex.lock().map_err(|_| Error::Storage.code())?;
        read_resource(&directory, &reference).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn write_ayase_resource(
    app: AppHandle,
    reference: String,
    data: String,
) -> Result<(), String> {
    let directory = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let item = self::reference(&reference).map_err(|error| error.code())?;
        let mutex = if item.background {
            &crate::background::BACKGROUND_FILES
        } else {
            &crate::attachments::FILE_OPERATIONS
        };
        let _guard = mutex.lock().map_err(|_| Error::Storage.code())?;
        write_resource(&directory, &reference, &data).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn remove_ayase_resources(app: AppHandle, references: Vec<String>) -> Result<(), String> {
    let directory = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Existing operations each take just one mutex; always acquire in this order.
        let _attachments = crate::attachments::FILE_OPERATIONS
            .lock()
            .map_err(|_| Error::Storage.code())?;
        let _backgrounds = crate::background::BACKGROUND_FILES
            .lock()
            .map_err(|_| Error::Storage.code())?;
        remove_resources(&directory, &references).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn assert_ayase_resources_available(
    app: AppHandle,
    references: Vec<String>,
) -> Result<(), String> {
    let directory = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _attachments = crate::attachments::FILE_OPERATIONS
            .lock()
            .map_err(|_| Error::Storage.code())?;
        let _backgrounds = crate::background::BACKGROUND_FILES
            .lock()
            .map_err(|_| Error::Storage.code())?;
        assert_resources_available(&directory, &references).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn ayase_backup_fence() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _attachments = crate::attachments::FILE_OPERATIONS
            .lock()
            .map_err(|_| Error::Storage.code())?;
        let _backgrounds = crate::background::BACKGROUND_FILES
            .lock()
            .map_err(|_| Error::Storage.code())?;
        Ok(())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    const TXT: &str = "attachments/01234567-89ab-4cde-8fab-0123456789ab.txt";
    const PNG: &str = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";

    #[test]
    fn rejects_noncanonical_and_nonmanaged_references() {
        for value in [
            "../secret",
            "attachments/../secret.txt",
            "attachments/0123456789ab4cde8fab0123456789ab.txt",
            "attachments/01234567-89ab-1cde-8fab-0123456789ab.txt",
            "attachments/01234567-89ab-4cde-7fab-0123456789ab.txt",
            "attachments/01234567-89AB-4cde-8fab-0123456789ab.txt",
            "backgrounds/thumbnails/01234567-89ab-4cde-8fab-0123456789ab.png",
            "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.pdf",
            "attachments/01234567-89ab-4cde-8fab-0123456789ab.exe",
        ] {
            assert!(
                matches!(reference(value), Err(Error::InvalidReference)),
                "{value}"
            );
        }
    }

    #[test]
    fn availability_checks_canonical_unique_bounded_list_without_creating_files() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(assert_resources_available(temp.path(), &[]), Ok(()));
        assert_eq!(
            assert_resources_available(temp.path(), &[TXT.into(), PNG.into()]),
            Ok(())
        );
        assert_eq!(
            assert_resources_available(temp.path(), &[TXT.into(), TXT.into()]),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            assert_resources_available(temp.path(), &[TXT.into(), "invalid".into()]),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            assert_resources_available(temp.path(), &vec![TXT.into(); REMOVE_LIMIT + 1]),
            Err(Error::TooLarge)
        );
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[test]
    fn availability_rejects_existing_attachment_in_each_read_location() {
        for subdirectory in [
            "attachments",
            "attachments/staging",
            "attachments/quarantine",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let directory = temp.path().join(subdirectory);
            std::fs::create_dir_all(&directory).unwrap();
            let path = directory.join(reference(TXT).unwrap().name);
            std::fs::write(&path, b"existing").unwrap();
            assert_eq!(
                assert_resources_available(temp.path(), &[TXT.into()]),
                Err(Error::Storage)
            );
            assert_eq!(
                assert_resources_available(temp.path(), &[TXT.into(), "invalid".into()]),
                Err(Error::InvalidReference)
            );
            assert_eq!(std::fs::read(&path).unwrap(), b"existing");
            assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        }
    }

    #[test]
    fn availability_rejects_existing_background_original_or_thumbnail() {
        let temp = tempfile::tempdir().unwrap();
        let item = reference(PNG).unwrap();
        let original = original_path(temp.path(), &item);
        let thumbnail = temp
            .path()
            .join("backgrounds/thumbnails")
            .join(format!("{}.png", item.name));
        std::fs::create_dir_all(thumbnail.parent().unwrap()).unwrap();
        for path in [&original, &thumbnail] {
            std::fs::write(path, b"existing").unwrap();
            assert_eq!(
                assert_resources_available(temp.path(), &[PNG.into()]),
                Err(Error::Storage)
            );
            assert_eq!(std::fs::read(path).unwrap(), b"existing");
            std::fs::remove_file(path).unwrap();
        }
        assert_eq!(
            assert_resources_available(temp.path(), &[PNG.into()]),
            Ok(())
        );
    }

    #[test]
    fn preserves_bytes_and_never_overwrites_existing_reference() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = "你好\r\ntext".as_bytes();
        write_resource(temp.path(), TXT, &STANDARD.encode(bytes)).unwrap();
        assert_eq!(
            read_resource(temp.path(), TXT).unwrap(),
            STANDARD.encode(bytes)
        );
        assert_eq!(
            write_resource(temp.path(), TXT, &STANDARD.encode("replacement")),
            Err(Error::Storage)
        );
        assert_eq!(std::fs::read(temp.path().join(TXT)).unwrap(), bytes);
        remove_resources(temp.path(), &[TXT.into()]).unwrap();
        remove_resources(temp.path(), &[TXT.into()]).unwrap();
        assert_eq!(read_resource(temp.path(), TXT), Err(Error::Unavailable));
    }

    #[test]
    fn attachment_fallback_is_deterministic_and_collision_protected() {
        let temp = tempfile::tempdir().unwrap();
        let name = reference(TXT).unwrap().name;
        std::fs::create_dir_all(temp.path().join("attachments/staging")).unwrap();
        std::fs::create_dir_all(temp.path().join("attachments/quarantine")).unwrap();
        std::fs::write(
            temp.path().join("attachments/staging").join(name),
            b"staged",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("attachments/quarantine").join(name),
            b"quarantined",
        )
        .unwrap();
        assert_eq!(
            read_resource(temp.path(), TXT).unwrap(),
            STANDARD.encode("staged")
        );
        assert_eq!(
            write_resource(temp.path(), TXT, &STANDARD.encode("new")),
            Err(Error::Storage)
        );
        std::fs::write(temp.path().join(TXT), b"active").unwrap();
        assert_eq!(
            read_resource(temp.path(), TXT).unwrap(),
            STANDARD.encode("active")
        );
    }

    #[test]
    fn validates_backgrounds_and_removes_paired_thumbnail() {
        let temp = tempfile::tempdir().unwrap();
        let png = include_bytes!("../icons/32x32.png");
        assert_eq!(
            write_resource(temp.path(), PNG, &STANDARD.encode(b"corrupt")),
            Err(Error::Corrupt)
        );
        assert!(!temp.path().join(PNG).exists());
        write_resource(temp.path(), PNG, &STANDARD.encode(png)).unwrap();
        assert_eq!(
            read_resource(temp.path(), PNG).unwrap(),
            STANDARD.encode(png)
        );
        let thumbnail = temp
            .path()
            .join("backgrounds/thumbnails")
            .join(format!("{}.png", reference(PNG).unwrap().name));
        std::fs::create_dir_all(thumbnail.parent().unwrap()).unwrap();
        std::fs::write(&thumbnail, b"derived").unwrap();
        remove_resources(temp.path(), &[PNG.into()]).unwrap();
        assert!(!temp.path().join(PNG).exists());
        assert!(!thumbnail.exists());
    }

    #[test]
    fn rejects_mismatched_background_type_and_decoded_dimensions() {
        let temp = tempfile::tempdir().unwrap();
        let png = include_bytes!("../icons/32x32.png");
        let jpg = PNG.replace(".png", ".jpg");
        assert_eq!(
            write_resource(temp.path(), &jpg, &STANDARD.encode(png)),
            Err(Error::Corrupt)
        );
        let mut output = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(16_385, 1)
            .write_to(&mut output, image::ImageFormat::Png)
            .unwrap();
        assert_eq!(
            write_resource(temp.path(), PNG, &STANDARD.encode(output.into_inner())),
            Err(Error::Corrupt)
        );
        assert!(!temp.path().join("backgrounds").exists());
    }

    #[test]
    fn rejects_invalid_attachment_bytes_and_journal_cleanup_removes_partial_copy() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(write_resource(temp.path(), TXT, "%%%"), Err(Error::Corrupt));
        assert_eq!(
            write_resource(temp.path(), TXT, &STANDARD.encode([0xff])),
            Err(Error::Corrupt)
        );
        let office = TXT.replace(".txt", ".docx");
        assert_eq!(
            write_resource(temp.path(), &office, &STANDARD.encode("not ZIP")),
            Err(Error::Corrupt)
        );
        assert!(!temp.path().join("attachments").exists());
        std::fs::create_dir(temp.path().join("attachments")).unwrap();
        File::create(temp.path().join(TXT)).unwrap();
        remove_resources(temp.path(), &[TXT.into()]).unwrap();
        assert!(!temp.path().join(TXT).exists());
    }

    #[test]
    fn prevalidates_entire_delete_list_and_limits_count() {
        let temp = tempfile::tempdir().unwrap();
        write_resource(temp.path(), TXT, &STANDARD.encode("keep")).unwrap();
        assert_eq!(
            remove_resources(temp.path(), &[TXT.into(), "invalid".into()]),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            remove_resources(temp.path(), &vec![TXT.into(); REMOVE_LIMIT + 1]),
            Err(Error::TooLarge)
        );
        assert!(temp.path().join(TXT).is_file());
    }

    #[test]
    fn bounded_reads_reject_oversized_sparse_files_before_allocation() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(temp.path().join("attachments")).unwrap();
        File::create(temp.path().join(TXT))
            .unwrap()
            .set_len(RESOURCE_LIMIT + 1)
            .unwrap();
        assert_eq!(read_resource(temp.path(), TXT), Err(Error::TooLarge));
        let backup = temp.path().join("backup.json");
        File::create(&backup)
            .unwrap()
            .set_len(BACKUP_LIMIT + 1)
            .unwrap();
        assert_eq!(read_backup(&backup), Err(Error::TooLarge));
        std::fs::create_dir_all(temp.path().join("backgrounds")).unwrap();
        File::create(temp.path().join(PNG))
            .unwrap()
            .set_len(crate::background::MAX_BACKGROUND_BYTES + 1)
            .unwrap();
        assert_eq!(read_resource(temp.path(), PNG), Err(Error::TooLarge));
    }

    #[test]
    fn backup_save_atomically_replaces_and_invalid_targets_leave_no_tempfiles() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("backup.json");
        save_backup(&path, "old").unwrap();
        save_backup(&path, "{\"new\":true}").unwrap();
        assert_eq!(read_backup(&path).unwrap(), "{\"new\":true}");
        std::fs::write(&path, b"\xff").unwrap();
        assert_eq!(read_backup(&path), Err(Error::Corrupt));
        let invalid = temp.path().join("directory");
        std::fs::create_dir(&invalid).unwrap();
        assert_eq!(save_backup(&invalid, "data"), Err(Error::InvalidReference));
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 2);
    }

    #[cfg(windows)]
    fn symlink_file(source: &Path, target: &Path) -> bool {
        match std::os::windows::fs::symlink_file(source, target) {
            Ok(()) => true,
            Err(error) if error.raw_os_error() == Some(1314) => {
                eprintln!("file-symlink assertions skipped: Windows symlink privilege unavailable");
                false
            }
            Err(error) => panic!("synthetic symlink creation failed: {error}"),
        }
    }
    #[cfg(unix)]
    fn symlink_file(source: &Path, target: &Path) -> bool {
        std::os::unix::fs::symlink(source, target).unwrap();
        true
    }

    #[test]
    fn rejects_file_symlinks_without_read_write_or_delete() {
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("outside.txt");
        std::fs::write(&outside, b"protected").unwrap();
        std::fs::create_dir(temp.path().join("attachments")).unwrap();
        if !symlink_file(&outside, &temp.path().join(TXT)) {
            return;
        }
        assert_eq!(
            read_resource(temp.path(), TXT),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            write_resource(temp.path(), TXT, &STANDARD.encode("overwrite")),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            remove_resources(temp.path(), &[TXT.into()]),
            Err(Error::InvalidReference)
        );
        assert_eq!(std::fs::read(outside).unwrap(), b"protected");
    }

    #[test]
    fn rejects_linked_directories_and_prevalidates_linked_thumbnail_before_deleting_original() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let linked = temp.path().join("attachments");
        #[cfg(windows)]
        {
            let output = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(&linked)
                .arg(outside.path())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "cannot create synthetic directory junction"
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &linked).unwrap();
        assert_eq!(
            assert_resources_available(temp.path(), &[TXT.into()]),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            read_resource(temp.path(), TXT),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            write_resource(temp.path(), TXT, &STANDARD.encode("data")),
            Err(Error::InvalidReference)
        );
        assert_eq!(
            remove_resources(temp.path(), &[TXT.into()]),
            Err(Error::InvalidReference)
        );
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);

        write_resource(
            temp.path(),
            PNG,
            &STANDARD.encode(include_bytes!("../icons/32x32.png")),
        )
        .unwrap();
        let thumbnails = temp.path().join("backgrounds").join("thumbnails");
        #[cfg(windows)]
        {
            let output = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(&thumbnails)
                .arg(outside.path())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "cannot create synthetic thumbnail junction"
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &thumbnails).unwrap();
        assert_eq!(
            remove_resources(temp.path(), &[PNG.into()]),
            Err(Error::InvalidReference)
        );
        assert!(temp.path().join(PNG).is_file());
        std::fs::remove_file(temp.path().join(PNG)).unwrap();
        assert_eq!(
            assert_resources_available(temp.path(), &[PNG.into()]),
            Err(Error::InvalidReference)
        );
    }
}
