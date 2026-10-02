use std::{collections::HashSet, fs::{FileTimes, OpenOptions}, io::Write,
    path::{Path, PathBuf}, sync::Mutex, time::{Duration, SystemTime}};

use base64::{Engine, engine::general_purpose::STANDARD};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::{Uuid, Variant, Version};

const QUARANTINE_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
pub(crate) fn import_mime(name: &str, bytes: &[u8]) -> Option<&'static str> {
    kind(name, bytes).ok().map(|(mime,_)| mime)
}
const SECOND_SCAN_AGE: Duration = Duration::from_secs(60 * 60);
pub(crate) static FILE_OPERATIONS: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq)]
enum AttachmentError { Unsupported, Corrupt, InvalidReference, Unavailable, Storage }
impl AttachmentError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unsupported => "attachment-unsupported", Self::Corrupt => "attachment-corrupt",
            Self::InvalidReference => "attachment-invalid-reference",
            Self::Unavailable => "attachment-unavailable", Self::Storage => "attachment-storage",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAttachment { reference: String, name: String, mime_type: String, size: usize }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentCheck { reference: String, size: usize }

fn kind(name: &str, bytes: &[u8]) -> Result<(&'static str, &'static str), AttachmentError> {
    if name.is_empty() || name.chars().any(|c| c.is_control() || c == '/' || c == '\\') {
        return Err(AttachmentError::Unsupported);
    }
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" => {
            let declared = match extension.as_str() {
                "png" => ImageFormat::Png, "jpg" | "jpeg" => ImageFormat::Jpeg,
                _ => ImageFormat::WebP,
            };
            let format = image::guess_format(bytes).ok()
                .filter(|format| matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP))
                .unwrap_or(declared);
            let (mime, ext) = match format {
                ImageFormat::Png => ("image/png", "png"), ImageFormat::Jpeg => ("image/jpeg", "jpg"),
                ImageFormat::WebP => ("image/webp", "webp"), _ => return Err(AttachmentError::Unsupported),
            };
            Ok((mime, ext))
        }
        "pdf" => Ok(("application/pdf", "pdf")),
        "docx" | "xlsx" | "pptx" => {
            if !bytes.starts_with(b"PK\x03\x04") { return Err(AttachmentError::Corrupt); }
            let mime = match extension.as_str() {
                "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                _ => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            };
            Ok((mime, match extension.as_str() {
                "docx" => "docx", "xlsx" => "xlsx", _ => "pptx",
            }))
        }
        "txt" | "md" | "markdown" => {
            std::str::from_utf8(bytes).map_err(|_| AttachmentError::Corrupt)?;
            Ok(if extension == "txt" { ("text/plain", "txt") } else { ("text/markdown", "md") })
        }
        "csv" | "tsv" | "json" | "xml" | "yaml" | "yml" | "log" | "html" | "htm"
        | "css" | "js" | "jsx" | "ts" | "tsx" | "py" | "rs" | "java" | "c" | "cpp"
        | "h" | "hpp" | "cs" | "go" | "sh" | "sql" | "toml" | "ini" | "tex" => {
            std::str::from_utf8(bytes).map_err(|_| AttachmentError::Corrupt)?;
            Ok(("text/plain", "txt"))
        }
        _ => Err(AttachmentError::Unsupported),
    }
}

fn managed_name(reference: &str) -> Result<&str, AttachmentError> {
    let filename = reference.strip_prefix("attachments/").ok_or(AttachmentError::InvalidReference)?;
    let (id, extension) = filename.rsplit_once('.').ok_or(AttachmentError::InvalidReference)?;
    let parsed = Uuid::parse_str(id).map_err(|_| AttachmentError::InvalidReference)?;
    if id.len() != 36 || parsed.get_version() != Some(Version::Random)
        || parsed.get_variant() != Variant::RFC4122 || parsed.hyphenated().to_string() != id {
        return Err(AttachmentError::InvalidReference);
    }
    if !matches!(extension, "png" | "jpg" | "webp" | "pdf" | "txt" | "md" | "docx" | "xlsx" | "pptx") {
        return Err(AttachmentError::InvalidReference);
    }
    Ok(filename)
}

fn save(app_data: &Path, name: String, data: String) -> Result<SavedAttachment, AttachmentError> {
    let bytes = STANDARD.decode(data).map_err(|_| AttachmentError::Corrupt)?;
    let (mime, ext) = kind(&name, &bytes)?;
    let dir = app_data.join("attachments").join("staging");
    std::fs::create_dir_all(&dir).map_err(|_| AttachmentError::Storage)?;
    let filename = format!("{}.{}", Uuid::new_v4(), ext);
    let path = dir.join(&filename);
    let mut file = OpenOptions::new().create_new(true).write(true).open(&path).map_err(|_| AttachmentError::Storage)?;
    if file.write_all(&bytes).is_err() || file.sync_all().is_err() {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(AttachmentError::Storage);
    }
    Ok(SavedAttachment { reference: format!("attachments/{filename}"), name, mime_type: mime.to_owned(), size: bytes.len() })
}

fn read_saved(app_data: &Path, reference: &str) -> Result<String, AttachmentError> {
    let filename = managed_name(reference)?;
    let dir = app_data.join("attachments");
    // A cleanup never makes a still-owned reference immediately unreadable.
    let mut bytes = None;
    for path in [dir.join(filename), dir.join("staging").join(filename), dir.join("quarantine").join(filename)] {
        let Ok(meta) = std::fs::metadata(&path) else { continue; };
        if !meta.is_file() { continue; }
        // Another app instance could rename after metadata but before read.
        if let Ok(value) = std::fs::read(&path) { bytes = Some(value); break; }
    }
    let bytes = bytes.ok_or(AttachmentError::Unavailable)?;
    let extension = filename.rsplit_once('.').unwrap().1;
    let sample_name = format!("sample.{extension}");
    kind(&sample_name, &bytes)?;
    Ok(STANDARD.encode(bytes))
}

fn verify_saved(app_data: &Path, items: &[AttachmentCheck]) -> Result<(), AttachmentError> {
    let dir = app_data.join("attachments");
    for item in items {
        let filename = managed_name(&item.reference)?;
        let mut found = false;
        for path in [dir.join(filename), dir.join("staging").join(filename), dir.join("quarantine").join(filename)] {
            match std::fs::File::open(path) {
                Ok(file) => {
                    let metadata = file.metadata().map_err(|_| AttachmentError::Storage)?;
                    if !metadata.is_file() || metadata.len() != item.size as u64 {
                        return Err(AttachmentError::Corrupt);
                    }
                    found = true;
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err(AttachmentError::Storage),
            }
        }
        if !found { return Err(AttachmentError::Unavailable); }
    }
    Ok(())
}

fn managed_names(references: &[String]) -> Result<HashSet<String>, AttachmentError> {
    references.iter().map(|reference| managed_name(reference).map(str::to_owned))
        .collect::<Result<HashSet<_>, _>>()
}

fn discard_uncommitted(app_data: &Path, references: &[String]) -> Result<(), AttachmentError> {
    let names = managed_names(references)?;
    let staging = app_data.join("attachments").join("staging");
    for name in names {
        match std::fs::remove_file(staging.join(name)) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(AttachmentError::Storage),
        }
    }
    Ok(())
}

fn cleanup(app_data: &Path, retained: &[String], pending: &[String]) -> Result<(), AttachmentError> {
    let names = managed_names(retained)?;
    let pending_names = managed_names(pending)?;
    let dir = app_data.join("attachments");
    let staging = dir.join("staging");
    let staged_entries = match std::fs::read_dir(&staging) {
        Ok(entries) => Some(entries),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(AttachmentError::Storage),
    };
    if let Some(entries) = staged_entries {
        for entry in entries {
            let entry = entry.map_err(|_| AttachmentError::Storage)?;
            if !entry.file_type().map_err(|_| AttachmentError::Storage)?.is_file() { continue; }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue; };
            if managed_name(&format!("attachments/{name}")).is_err() { continue; }
            if names.contains(&name) {
                if dir.join(&name).is_file() {
                    std::fs::remove_file(entry.path()).map_err(|_| AttachmentError::Storage)?;
                } else {
                    std::fs::rename(entry.path(), dir.join(&name)).map_err(|_| AttachmentError::Storage)?;
                }
            } else if !pending_names.contains(&name) {
                std::fs::remove_file(entry.path()).map_err(|_| AttachmentError::Storage)?;
            }
        }
    }
    let quarantine = dir.join("quarantine");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(AttachmentError::Storage),
    };
    std::fs::create_dir_all(&quarantine).map_err(|_| AttachmentError::Storage)?;
    for entry in entries {
        let entry = entry.map_err(|_| AttachmentError::Storage)?;
        if !entry.file_type().map_err(|_| AttachmentError::Storage)?.is_file() { continue; }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue; };
        if managed_name(&format!("attachments/{name}")).is_ok() && !names.contains(&name) {
            let target = quarantine.join(&name);
            // Establish the grace period before the move. A crash after rename
            // must not turn an old file into an immediately expiring orphan.
            let file = OpenOptions::new().write(true).open(entry.path()).map_err(|_| AttachmentError::Storage)?;
            file.set_times(FileTimes::new().set_modified(SystemTime::now())).map_err(|_| AttachmentError::Storage)?;
            drop(file);
            std::fs::rename(entry.path(), &target).map_err(|_| AttachmentError::Storage)?;
        }
    }
    for entry in std::fs::read_dir(&quarantine).map_err(|_| AttachmentError::Storage)? {
        let entry = entry.map_err(|_| AttachmentError::Storage)?;
        if !entry.file_type().map_err(|_| AttachmentError::Storage)?.is_file() { continue; }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue; };
        if managed_name(&format!("attachments/{name}")).is_err() { continue; }
        let scan = quarantine.join(format!("{name}.scan"));
        if names.contains(&name) {
            std::fs::rename(entry.path(), dir.join(&name)).map_err(|_| AttachmentError::Storage)?;
            if scan.exists() { std::fs::remove_file(scan).map_err(|_| AttachmentError::Storage)?; }
            continue;
        }
        let modified = entry.metadata().and_then(|meta| meta.modified()).map_err(|_| AttachmentError::Storage)?;
        if SystemTime::now().duration_since(modified).unwrap_or_default() < QUARANTINE_AGE { continue; }
        if let Ok(first_scan) = std::fs::metadata(&scan) {
            let scanned_at = first_scan.modified().map_err(|_| AttachmentError::Storage)?;
            if SystemTime::now().duration_since(scanned_at).unwrap_or_default() >= SECOND_SCAN_AGE {
                std::fs::remove_file(entry.path()).map_err(|_| AttachmentError::Storage)?;
                std::fs::remove_file(scan).map_err(|_| AttachmentError::Storage)?;
            }
        } else {
            OpenOptions::new().write(true).create_new(true).open(scan)
                .map_err(|_| AttachmentError::Storage)?;
        }
    }
    Ok(())
}

fn app_data(app: &AppHandle) -> Result<PathBuf, AttachmentError> {
    app.path().app_data_dir().map_err(|_| AttachmentError::Storage)
}

#[tauri::command]
pub fn persist_attachment(app: AppHandle, name: String, data: String) -> Result<SavedAttachment, String> {
    let _guard = FILE_OPERATIONS.lock().map_err(|_| AttachmentError::Storage.code())?;
    save(&app_data(&app).map_err(|error| error.code())?, name, data).map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn read_sent_attachment(app: AppHandle, reference: String) -> Result<String, String> {
    let _guard = FILE_OPERATIONS.lock().map_err(|_| AttachmentError::Storage.code())?;
    read_saved(&app_data(&app).map_err(|error| error.code())?, &reference).map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn verify_sent_attachments(app: AppHandle, items: Vec<AttachmentCheck>) -> Result<(), String> {
    let _guard = FILE_OPERATIONS.lock().map_err(|_| AttachmentError::Storage.code())?;
    verify_saved(&app_data(&app).map_err(|error| error.code())?, &items)
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn discard_uncommitted_attachments(app: AppHandle, references: Vec<String>) -> Result<(), String> {
    let _guard = FILE_OPERATIONS.lock().map_err(|_| AttachmentError::Storage.code())?;
    discard_uncommitted(&app_data(&app).map_err(|error| error.code())?, &references)
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn cleanup_sent_attachments(app: AppHandle, retained_references: Vec<String>, pending_references: Vec<String>) -> Result<(), String> {
    let _guard = FILE_OPERATIONS.lock().map_err(|_| AttachmentError::Storage.code())?;
    cleanup(&app_data(&app).map_err(|error| error.code())?, &retained_references, &pending_references)
        .map_err(|error| error.code().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_types_and_reference_safety() {
        assert_eq!(kind("a.txt", b"hello"), Ok(("text/plain", "txt")));
        assert_eq!(kind("a.png", b"hello"), Ok(("image/png", "png")));
        assert_eq!(kind("a.pdf", b"%PDF-1.7\n"), Ok(("application/pdf", "pdf")));
        assert_eq!(kind("a.pdf", b"unreadable"), Ok(("application/pdf", "pdf")));
        assert_eq!(managed_name("attachments/../secret.pdf"), Err(AttachmentError::InvalidReference));
        assert_eq!(managed_name("attachments/123e4567e89b42d3a456426614174000.txt"),
            Err(AttachmentError::InvalidReference));
        assert_eq!(managed_name("attachments/123e4567-e89b-12d3-a456-426614174000.txt"),
            Err(AttachmentError::InvalidReference));
        assert_eq!(kind(&format!("{}.txt", "中".repeat(100)), b"hello"), Ok(("text/plain", "txt")));
        assert_eq!(kind("bad\u{7f}name.txt", b"hello"), Err(AttachmentError::Unsupported));
    }

    #[test]
    fn unrecognized_image_header_does_not_create_a_second_native_format_gate() {
        assert_eq!(kind("unknown.png", b"GIF89a\x01\x00\x01\x00"), Ok(("image/png", "png")));
    }

    #[test]
    fn office_files_keep_their_original_bytes_and_mime_types() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = b"PK\x03\x04original office bytes\x00\xff";
        for (extension, mime) in [
            ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        ] {
            let name = format!("report.{extension}");
            let saved = save(temp.path(), name.clone(), STANDARD.encode(bytes)).unwrap();
            assert_eq!(saved.name, name);
            assert_eq!(saved.mime_type, mime);
            assert!(saved.reference.ends_with(&format!(".{extension}")));
            assert_eq!(read_saved(temp.path(), &saved.reference).unwrap(), STANDARD.encode(bytes));
        }
    }

    #[test]
    fn office_files_require_a_zip_local_header() {
        for extension in ["docx", "xlsx", "pptx"] {
            assert_eq!(kind(&format!("report.{extension}"), b"PK\x05\x06"), Err(AttachmentError::Corrupt));
            assert_eq!(kind(&format!("report.{extension}"), b"PK\x03"), Err(AttachmentError::Corrupt));
        }
    }

    #[test]
    fn utf8_text_extensions_are_stored_as_plain_text() {
        let temp = tempfile::tempdir().unwrap();
        for extension in ["csv", "tsv", "json", "xml", "yaml", "yml", "log", "html", "htm",
            "css", "js", "jsx", "ts", "tsx", "py", "rs", "java", "c", "cpp", "h", "hpp",
            "cs", "go", "sh", "sql", "toml", "ini", "tex"] {
            let name = format!("source.{extension}");
            let saved = save(temp.path(), name.clone(), STANDARD.encode("你好")).unwrap();
            assert_eq!(saved.name, name);
            assert_eq!(saved.mime_type, "text/plain");
            assert!(saved.reference.ends_with(".txt"));
            assert_eq!(read_saved(temp.path(), &saved.reference).unwrap(), STANDARD.encode("你好"));
            assert_eq!(kind(&name, b"\xff"), Err(AttachmentError::Corrupt));
        }
        assert_eq!(kind("notes.md", b"markdown"), Ok(("text/markdown", "md")));
    }

    #[test]
    fn renamed_supported_image_is_saved_and_read_using_its_actual_format() {
        let temp = tempfile::tempdir().unwrap();
        let png = include_bytes!("../icons/32x32.png");
        let sent = save(temp.path(), "renamed.jpg".to_owned(), STANDARD.encode(png)).unwrap();
        assert_eq!(sent.name, "renamed.jpg");
        assert_eq!(sent.mime_type, "image/png");
        assert!(sent.reference.ends_with(".png"));
        assert_eq!(read_saved(temp.path(), &sent.reference).unwrap(), STANDARD.encode(png));
    }

    #[test]
    fn saves_and_reads_sent_files_beyond_the_old_local_limit() {
        let temp = tempfile::tempdir().unwrap();
        let content = vec![b'a'; 10_000_001];
        let sent = save(temp.path(), "large.txt".to_owned(), STANDARD.encode(&content)).unwrap();
        assert_eq!(sent.size, content.len());
        assert_eq!(read_saved(temp.path(), &sent.reference).unwrap(), STANDARD.encode(&content));
    }

    #[test]
    fn uncommitted_copy_is_readable_but_removed_immediately_when_discarded() {
        let temp = tempfile::tempdir().unwrap();
        let sent = save(temp.path(), "draft.txt".to_owned(), STANDARD.encode("hello")).unwrap();
        let name = managed_name(&sent.reference).unwrap();
        assert!(temp.path().join("attachments/staging").join(name).is_file());
        assert!(!temp.path().join(&sent.reference).exists());
        assert_eq!(read_saved(temp.path(), &sent.reference).unwrap(), STANDARD.encode("hello"));
        discard_uncommitted(temp.path(), std::slice::from_ref(&sent.reference)).unwrap();
        assert_eq!(read_saved(temp.path(), &sent.reference), Err(AttachmentError::Unavailable));
        assert!(!temp.path().join("attachments/quarantine").join(name).exists());
    }

    #[test]
    fn verifies_all_staged_copies_by_managed_reference_and_size_without_loading_contents() {
        let temp = tempfile::tempdir().unwrap();
        let first = save(temp.path(), "first.txt".to_owned(), STANDARD.encode("first")).unwrap();
        let second = save(temp.path(), "second.txt".to_owned(), STANDARD.encode("second")).unwrap();
        let checks = [AttachmentCheck { reference: first.reference.clone(), size: first.size },
            AttachmentCheck { reference: second.reference.clone(), size: second.size }];
        assert_eq!(verify_saved(temp.path(), &checks), Ok(()));
        discard_uncommitted(temp.path(), std::slice::from_ref(&second.reference)).unwrap();
        assert_eq!(verify_saved(temp.path(), &checks), Err(AttachmentError::Unavailable));
        assert_eq!(verify_saved(temp.path(), &[AttachmentCheck { reference: first.reference, size: 1 }]),
            Err(AttachmentError::Corrupt));
    }

    #[test]
    fn cleanup_never_touches_uuid_shaped_files_that_this_app_did_not_generate() {
        let temp = tempfile::tempdir().unwrap();
        let active = temp.path().join("attachments");
        let staging = active.join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let simple = "123e4567e89b42d3a456426614174000.txt";
        let wrong_version = "123e4567-e89b-12d3-a456-426614174000.txt";
        std::fs::write(active.join(simple), b"unmanaged").unwrap();
        std::fs::write(staging.join(wrong_version), b"unmanaged").unwrap();
        cleanup(temp.path(), &[], &[]).unwrap();
        assert!(active.join(simple).is_file());
        assert!(staging.join(wrong_version).is_file());
    }

    #[test]
    fn cleanup_promotes_committed_staging_and_removes_crashed_uncommitted_staging() {
        let temp = tempfile::tempdir().unwrap();
        let committed = save(temp.path(), "sent.txt".to_owned(), STANDARD.encode("sent")).unwrap();
        let crashed = save(temp.path(), "draft.txt".to_owned(), STANDARD.encode("draft")).unwrap();
        cleanup(temp.path(), std::slice::from_ref(&committed.reference), &[]).unwrap();
        assert!(temp.path().join(&committed.reference).is_file());
        assert_eq!(read_saved(temp.path(), &crashed.reference), Err(AttachmentError::Unavailable));
        let pending = save(temp.path(), "pending.txt".to_owned(), STANDARD.encode("pending")).unwrap();
        cleanup(temp.path(), std::slice::from_ref(&committed.reference), std::slice::from_ref(&pending.reference)).unwrap();
        assert!(temp.path().join("attachments/staging").join(managed_name(&pending.reference).unwrap()).is_file());
        cleanup(temp.path(), &[committed.reference, pending.reference.clone()], &[]).unwrap();
        assert!(temp.path().join(&pending.reference).is_file());
    }

    #[test]
    fn saved_copy_survives_source_deletion_and_cleanup_preserves_refs() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.txt");
        std::fs::write(&source, b"hello").unwrap();
        let sent = save(temp.path(), "source.txt".to_owned(), STANDARD.encode(std::fs::read(&source).unwrap())).unwrap();
        std::fs::remove_file(source).unwrap();
        assert_eq!(read_saved(temp.path(), &sent.reference).unwrap(), STANDARD.encode("hello"));
        cleanup(temp.path(), std::slice::from_ref(&sent.reference), &[]).unwrap();
        assert!(read_saved(temp.path(), &sent.reference).is_ok());
        cleanup(temp.path(), &[], &[]).unwrap();
        assert!(read_saved(temp.path(), &sent.reference).is_ok());
        cleanup(temp.path(), std::slice::from_ref(&sent.reference), &[]).unwrap();
        assert!(read_saved(temp.path(), &sent.reference).is_ok());
        assert!(temp.path().join(&sent.reference).is_file());
    }

    #[test]
    fn quarantine_requires_grace_and_two_unowned_scans_before_final_removal() {
        let temp = tempfile::tempdir().unwrap();
        let sent = save(temp.path(), "draft.txt".to_owned(), STANDARD.encode("hello")).unwrap();
        cleanup(temp.path(), std::slice::from_ref(&sent.reference), &[]).unwrap();
        cleanup(temp.path(), &[], &[]).unwrap();
        let name = managed_name(&sent.reference).unwrap();
        let quarantine = temp.path().join("attachments/quarantine");
        let file = quarantine.join(name);
        assert!(file.is_file());
        assert!(read_saved(temp.path(), &sent.reference).is_ok());
        cleanup(temp.path(), &[], &[]).unwrap();
        assert!(file.is_file());
        let before_grace = SystemTime::now() - QUARANTINE_AGE - Duration::from_secs(120);
        OpenOptions::new().write(true).open(&file).unwrap()
            .set_times(FileTimes::new().set_modified(before_grace)).unwrap();
        cleanup(temp.path(), &[], &[]).unwrap();
        let scan = quarantine.join(format!("{name}.scan"));
        assert!(scan.is_file());
        assert!(file.is_file());
        OpenOptions::new().write(true).open(&scan).unwrap()
            .set_times(FileTimes::new().set_modified(SystemTime::now() - SECOND_SCAN_AGE - Duration::from_secs(120))).unwrap();
        cleanup(temp.path(), &[], &[]).unwrap();
        assert!(!file.exists());
        assert!(!scan.exists());
        assert_eq!(read_saved(temp.path(), &sent.reference), Err(AttachmentError::Unavailable));
    }

    #[test]
    fn invalid_retained_set_cannot_move_files_and_returned_owner_cancels_purge() {
        let temp = tempfile::tempdir().unwrap();
        let sent = save(temp.path(), "note.txt".to_owned(), STANDARD.encode("hello")).unwrap();
        cleanup(temp.path(), std::slice::from_ref(&sent.reference), &[]).unwrap();
        assert_eq!(cleanup(temp.path(), &["attachments/../secret.txt".to_owned()], &[]),
            Err(AttachmentError::InvalidReference));
        assert!(temp.path().join(&sent.reference).is_file());
        cleanup(temp.path(), &[], &[]).unwrap();
        let name = managed_name(&sent.reference).unwrap();
        let quarantine = temp.path().join("attachments/quarantine");
        let file = quarantine.join(name);
        OpenOptions::new().write(true).open(&file).unwrap()
            .set_times(FileTimes::new().set_modified(SystemTime::now() - QUARANTINE_AGE - Duration::from_secs(120))).unwrap();
        cleanup(temp.path(), &[], &[]).unwrap();
        let scan = quarantine.join(format!("{name}.scan"));
        assert!(scan.is_file());
        cleanup(temp.path(), std::slice::from_ref(&sent.reference), &[]).unwrap();
        assert!(temp.path().join(&sent.reference).is_file());
        assert!(!scan.exists());
        assert!(read_saved(temp.path(), &sent.reference).is_ok());
    }
}
