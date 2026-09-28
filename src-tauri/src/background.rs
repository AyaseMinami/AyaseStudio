use std::{
    collections::HashSet,
    fs::OpenOptions,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub const MAX_BACKGROUND_BYTES: u64 = 20_000_000;
const MAX_THUMBNAIL_EDGE: u32 = 512;
const MAX_THUMBNAIL_BYTES: u64 = 2_000_000;
// Import, resolve and cleanup share one lock, including legacy thumbnail creation.
static BACKGROUND_FILES: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq)]
enum BackgroundError {
    TooLarge,
    UnsupportedType,
    Corrupt,
    InvalidReference,
    Unavailable,
    StorageFailed,
}

impl BackgroundError {
    fn code(&self) -> &'static str {
        match self {
            Self::TooLarge => "background-too-large",
            Self::UnsupportedType => "background-unsupported-type",
            Self::Corrupt => "background-corrupt",
            Self::InvalidReference => "background-invalid-reference",
            Self::Unavailable => "background-unavailable",
            Self::StorageFailed => "background-storage-failed",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum BackgroundKind {
    Png,
    Jpeg,
    WebP,
}

impl BackgroundKind {
    fn extension(&self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::WebP => "webp",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ImportedBackground {
    reference: String,
    absolute_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundResourcePayload {
    reference: String,
    absolute_path: String,
    name: Option<String>,
}

impl TryFrom<ImportedBackground> for BackgroundResourcePayload {
    type Error = String;

    fn try_from(resource: ImportedBackground) -> Result<Self, Self::Error> {
        let absolute_path = resource
            .absolute_path
            .into_os_string()
            .into_string()
            .map_err(|_| BackgroundError::StorageFailed.code().to_owned())?;
        Ok(Self {
            reference: resource.reference,
            absolute_path,
            name: None,
        })
    }
}

fn validate_background_size(size: u64) -> Result<(), BackgroundError> {
    if size > MAX_BACKGROUND_BYTES {
        Err(BackgroundError::TooLarge)
    } else {
        Ok(())
    }
}

#[cfg(test)]
fn validate_background_bytes(bytes: &[u8]) -> Result<BackgroundKind, BackgroundError> {
    decode_background_bytes(bytes).map(|(kind, _)| kind)
}

fn decode_background_bytes(
    bytes: &[u8],
) -> Result<(BackgroundKind, DynamicImage), BackgroundError> {
    validate_background_size(bytes.len() as u64)?;
    let format = image::guess_format(bytes).map_err(|_| BackgroundError::UnsupportedType)?;
    let kind = match format {
        ImageFormat::Png => BackgroundKind::Png,
        ImageFormat::Jpeg => BackgroundKind::Jpeg,
        ImageFormat::WebP => BackgroundKind::WebP,
        _ => return Err(BackgroundError::UnsupportedType),
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| BackgroundError::Corrupt)?;
    Ok((kind, image))
}

fn thumbnail_path(app_data_dir: &Path, file_name: &str) -> PathBuf {
    app_data_dir
        .join("backgrounds/thumbnails")
        .join(format!("{file_name}.png"))
}

fn validate_thumbnail(path: &Path) -> Result<(), BackgroundError> {
    let metadata = std::fs::metadata(path).map_err(|_| BackgroundError::Corrupt)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_THUMBNAIL_BYTES {
        return Err(BackgroundError::Corrupt);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| BackgroundError::Corrupt)?
        .take(MAX_THUMBNAIL_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| BackgroundError::Corrupt)?;
    if bytes.len() as u64 > MAX_THUMBNAIL_BYTES {
        return Err(BackgroundError::Corrupt);
    }
    if image::guess_format(&bytes).ok() != Some(ImageFormat::Png) {
        return Err(BackgroundError::Corrupt);
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_THUMBNAIL_EDGE);
    limits.max_image_height = Some(MAX_THUMBNAIL_EDGE);
    limits.max_alloc = Some(4 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    reader.limits(limits);
    reader.decode().map_err(|_| BackgroundError::Corrupt)?;
    Ok(())
}

fn save_thumbnail(image: &DynamicImage, path: &Path) -> Result<(), BackgroundError> {
    let directory = path.parent().ok_or(BackgroundError::StorageFailed)?;
    std::fs::create_dir_all(directory).map_err(|_| BackgroundError::StorageFailed)?;
    let thumbnail = if image.width() > MAX_THUMBNAIL_EDGE || image.height() > MAX_THUMBNAIL_EDGE {
        image.thumbnail(MAX_THUMBNAIL_EDGE, MAX_THUMBNAIL_EDGE)
    } else {
        image.clone()
    };
    // Same-directory persist atomically replaces existing files on Windows as well.
    let mut output =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| BackgroundError::StorageFailed)?;
    DynamicImage::ImageRgba8(thumbnail.to_rgba8())
        .write_to(output.as_file_mut(), ImageFormat::Png)
        .map_err(|_| BackgroundError::StorageFailed)?;
    output
        .as_file()
        .sync_all()
        .map_err(|_| BackgroundError::StorageFailed)?;
    output
        .persist(path)
        .map_err(|_| BackgroundError::StorageFailed)?;
    Ok(())
}

fn managed_file_name(reference: &str) -> Result<&str, BackgroundError> {
    let file_name = reference
        .strip_prefix("backgrounds/")
        .ok_or(BackgroundError::InvalidReference)?;
    if file_name.contains(['/', '\\']) {
        return Err(BackgroundError::InvalidReference);
    }
    let (identifier, extension) = file_name
        .rsplit_once('.')
        .ok_or(BackgroundError::InvalidReference)?;
    if !matches!(extension, "png" | "jpg" | "webp") {
        return Err(BackgroundError::InvalidReference);
    }
    let bytes = identifier.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[14] != b'4'
        || bytes[18] != b'-'
        || !matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        || bytes[23] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, value)| !matches!(index, 8 | 13 | 18 | 23) && !value.is_ascii_hexdigit())
    {
        return Err(BackgroundError::InvalidReference);
    }
    Ok(file_name)
}

fn import_background_from_path(
    source: &Path,
    app_data_dir: &Path,
) -> Result<ImportedBackground, BackgroundError> {
    let _guard = BACKGROUND_FILES
        .lock()
        .map_err(|_| BackgroundError::StorageFailed)?;
    let metadata = std::fs::metadata(source).map_err(|_| BackgroundError::Unavailable)?;
    if !metadata.is_file() {
        return Err(BackgroundError::Unavailable);
    }
    validate_background_size(metadata.len())?;
    let bytes = std::fs::read(source).map_err(|_| BackgroundError::Unavailable)?;
    let (kind, image) = decode_background_bytes(&bytes)?;

    let background_dir = app_data_dir.join("backgrounds");
    std::fs::create_dir_all(&background_dir).map_err(|_| BackgroundError::StorageFailed)?;
    let file_name = format!("{}.{}", Uuid::new_v4(), kind.extension());
    let absolute_path = background_dir.join(&file_name);
    let mut destination = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&absolute_path)
        .map_err(|_| BackgroundError::StorageFailed)?;
    if destination.write_all(&bytes).is_err() || destination.sync_all().is_err() {
        drop(destination);
        let _ = std::fs::remove_file(&absolute_path);
        return Err(BackgroundError::StorageFailed);
    }
    drop(destination);
    if let Err(error) = save_thumbnail(&image, &thumbnail_path(app_data_dir, &file_name)) {
        let _ = std::fs::remove_file(&absolute_path);
        return Err(error);
    }

    Ok(ImportedBackground {
        reference: format!("backgrounds/{file_name}"),
        absolute_path,
    })
}

fn cleanup_background_files(
    app_data_dir: &Path,
    retained_references: &[String],
) -> Result<(), BackgroundError> {
    let _guard = BACKGROUND_FILES
        .lock()
        .map_err(|_| BackgroundError::StorageFailed)?;
    let retained_names = retained_references
        .iter()
        .map(|reference| managed_file_name(reference).map(str::to_owned))
        .collect::<Result<HashSet<_>, _>>()?;
    let background_dir = app_data_dir.join("backgrounds");
    let entries = match std::fs::read_dir(&background_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(BackgroundError::StorageFailed),
    };

    for entry in entries {
        let entry = entry.map_err(|_| BackgroundError::StorageFailed)?;
        let file_type = entry
            .file_type()
            .map_err(|_| BackgroundError::StorageFailed)?;
        if !file_type.is_file() {
            continue;
        }
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let reference = format!("backgrounds/{file_name}");
        if managed_file_name(&reference).is_ok() && !retained_names.contains(&file_name) {
            std::fs::remove_file(entry.path()).map_err(|_| BackgroundError::StorageFailed)?;
        }
    }
    let thumbnails = match std::fs::read_dir(background_dir.join("thumbnails")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(BackgroundError::StorageFailed),
    };
    for entry in thumbnails {
        let entry = entry.map_err(|_| BackgroundError::StorageFailed)?;
        if !entry
            .file_type()
            .map_err(|_| BackgroundError::StorageFailed)?
            .is_file()
        {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(original_name) = name.strip_suffix(".png") else {
            continue;
        };
        if managed_file_name(&format!("backgrounds/{original_name}")).is_err() {
            continue;
        }
        if !retained_names.contains(original_name) || !background_dir.join(original_name).is_file()
        {
            std::fs::remove_file(entry.path()).map_err(|_| BackgroundError::StorageFailed)?;
        }
    }
    Ok(())
}

#[cfg(test)]
fn resolve_background_reference(
    app_data_dir: &Path,
    reference: &str,
) -> Result<ImportedBackground, BackgroundError> {
    resolve_background_resource(app_data_dir, reference, false, false)
}

fn resolve_background_resource(
    app_data_dir: &Path,
    reference: &str,
    thumbnail: bool,
    refresh: bool,
) -> Result<ImportedBackground, BackgroundError> {
    let _guard = BACKGROUND_FILES
        .lock()
        .map_err(|_| BackgroundError::StorageFailed)?;
    let file_name = managed_file_name(reference)?;
    let absolute_path = app_data_dir.join("backgrounds").join(file_name);
    let metadata = std::fs::metadata(&absolute_path).map_err(|_| BackgroundError::Unavailable)?;
    if !metadata.is_file() {
        return Err(BackgroundError::Unavailable);
    }
    validate_background_size(metadata.len())?;
    if metadata.len() == 0 {
        return Err(BackgroundError::Corrupt);
    }
    let cached_path = thumbnail_path(app_data_dir, file_name);
    if thumbnail && !refresh && validate_thumbnail(&cached_path).is_ok() {
        return Ok(ImportedBackground {
            reference: reference.to_owned(),
            absolute_path: cached_path,
        });
    }
    let bytes = std::fs::read(&absolute_path).map_err(|_| BackgroundError::Unavailable)?;
    let (kind, image) = decode_background_bytes(&bytes)?;
    if !file_name.ends_with(&format!(".{}", kind.extension())) {
        return Err(BackgroundError::Corrupt);
    }
    let absolute_path = if thumbnail {
        save_thumbnail(&image, &cached_path)?;
        cached_path
    } else {
        absolute_path
    };
    Ok(ImportedBackground {
        reference: reference.to_owned(),
        absolute_path,
    })
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| BackgroundError::StorageFailed.code().to_owned())
}

#[tauri::command]
pub async fn select_background_image(
    app: AppHandle,
) -> Result<Option<BackgroundResourcePayload>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("PNG, JPEG 或 WebP 图片", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let source = selected
        .into_path()
        .map_err(|_| BackgroundError::Unavailable.code().to_owned())?;
    let name = source
        .file_stem()
        .and_then(|name| name.to_str())
        .map(|name| name.chars().take(100).collect());
    let directory = app_data_dir(&app)?;
    let imported = tauri::async_runtime::spawn_blocking(move || {
        import_background_from_path(&source, &directory)
    })
    .await
    .map_err(|_| BackgroundError::StorageFailed.code().to_owned())?
    .map_err(|error| error.code().to_owned())?;
    let mut payload = BackgroundResourcePayload::try_from(imported)?;
    // Only the basename crosses the boundary; the source path is never persisted or sent to React.
    payload.name = name;
    Ok(Some(payload))
}

#[tauri::command]
pub async fn resolve_background_image(
    app: AppHandle,
    reference: String,
    thumbnail: Option<bool>,
    refresh: Option<bool>,
) -> Result<BackgroundResourcePayload, String> {
    let directory = app_data_dir(&app)?;
    let resource = tauri::async_runtime::spawn_blocking(move || {
        resolve_background_resource(
            &directory,
            &reference,
            thumbnail.unwrap_or(false),
            refresh.unwrap_or(false),
        )
    })
    .await
    .map_err(|_| BackgroundError::StorageFailed.code().to_owned())?
    .map_err(|error| error.code().to_owned())?;
    BackgroundResourcePayload::try_from(resource)
}

#[tauri::command]
pub async fn cleanup_background_images(
    app: AppHandle,
    retained_references: Vec<String>,
) -> Result<(), String> {
    let directory = app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_background_files(&directory, &retained_references)
    })
    .await
    .map_err(|_| BackgroundError::StorageFailed.code().to_owned())?
    .map_err(|error| error.code().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_image(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba([24, 64, 128, 80]));
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn legacy_image(app_data: &Path, bytes: &[u8]) -> String {
        let reference = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
        std::fs::create_dir_all(app_data.join("backgrounds")).unwrap();
        std::fs::write(app_data.join(reference), bytes).unwrap();
        reference.to_owned()
    }

    #[test]
    fn thumbnails_preserve_aspect_alpha_small_sizes_and_original_bytes() {
        for (width, height, expected) in [
            (1024, 256, (512, 128)),
            (256, 1024, (128, 512)),
            (512, 512, (512, 512)),
            (23, 17, (23, 17)),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let bytes = png_image(width, height);
            let source = temp.path().join("original.png");
            let app_data = temp.path().join("data");
            std::fs::write(&source, &bytes).unwrap();
            let imported = import_background_from_path(&source, &app_data).unwrap();
            let resolved =
                resolve_background_resource(&app_data, &imported.reference, true, false).unwrap();
            assert_eq!(resolved.reference, imported.reference);
            assert_eq!(
                resolved.absolute_path,
                thumbnail_path(&app_data, managed_file_name(&imported.reference).unwrap())
            );
            let thumbnail = image::open(resolved.absolute_path).unwrap().to_rgba8();
            assert_eq!(thumbnail.dimensions(), expected);
            assert_eq!(thumbnail.get_pixel(0, 0).0[3], 80);
            assert_eq!(std::fs::read(imported.absolute_path).unwrap(), bytes);
            assert_eq!(std::fs::read(source).unwrap(), bytes);
        }
    }

    #[test]
    fn jpeg_thumbnail_name_includes_the_original_extension() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("photo.jpeg");
        DynamicImage::new_rgb8(1200, 600)
            .save_with_format(&source, ImageFormat::Jpeg)
            .unwrap();
        let imported = import_background_from_path(&source, temp.path()).unwrap();
        let resolved =
            resolve_background_resource(temp.path(), &imported.reference, true, false).unwrap();
        assert!(
            resolved
                .absolute_path
                .to_str()
                .unwrap()
                .ends_with(".jpg.png")
        );
        assert_eq!(image::open(resolved.absolute_path).unwrap().width(), 512);
    }

    #[test]
    fn old_images_lazily_create_thumbnails_and_hot_reads_do_not_decode_originals() {
        let temp = tempfile::tempdir().unwrap();
        let reference = legacy_image(temp.path(), &png_image(1024, 512));
        let cached = thumbnail_path(temp.path(), managed_file_name(&reference).unwrap());
        assert!(!cached.exists());
        let resolved = resolve_background_resource(temp.path(), &reference, true, false).unwrap();
        assert_eq!(resolved.absolute_path, cached);
        std::fs::write(temp.path().join(&reference), b"\x89PNG\r\n\x1a\ntruncated").unwrap();
        assert!(resolve_background_resource(temp.path(), &reference, true, false).is_ok());
        assert_eq!(
            resolve_background_reference(temp.path(), &reference),
            Err(BackgroundError::Corrupt)
        );
        assert_eq!(
            resolve_background_resource(temp.path(), &reference, true, true),
            Err(BackgroundError::Corrupt)
        );
        std::fs::remove_file(temp.path().join(&reference)).unwrap();
        assert_eq!(
            resolve_background_resource(temp.path(), &reference, true, false),
            Err(BackgroundError::Unavailable)
        );
    }

    #[test]
    fn missing_corrupt_and_oversized_thumbnails_are_rebuilt() {
        let temp = tempfile::tempdir().unwrap();
        let reference = legacy_image(temp.path(), &png_image(800, 400));
        let cached = thumbnail_path(temp.path(), managed_file_name(&reference).unwrap());
        resolve_background_resource(temp.path(), &reference, true, false).unwrap();
        for replacement in [b"broken".to_vec(), png_image(513, 1)] {
            std::fs::write(&cached, replacement).unwrap();
            resolve_background_resource(temp.path(), &reference, true, false).unwrap();
            assert_eq!(image::open(&cached).unwrap().width(), 512);
        }
        std::fs::write(&cached, png_image(7, 3)).unwrap();
        resolve_background_resource(temp.path(), &reference, true, true).unwrap();
        assert_eq!(image::open(&cached).unwrap().width(), 512);
        std::fs::write(&cached, b"broken").unwrap();
        resolve_background_resource(temp.path(), &reference, true, true).unwrap();
        assert_eq!(image::open(&cached).unwrap().height(), 256);
    }

    #[test]
    fn thumbnail_failures_never_return_originals_or_leave_failed_imports() {
        let temp = tempfile::tempdir().unwrap();
        let reference = legacy_image(temp.path(), &png_image(30, 20));
        std::fs::write(
            temp.path().join("backgrounds/thumbnails"),
            b"block directory",
        )
        .unwrap();
        assert_eq!(
            resolve_background_resource(temp.path(), &reference, true, false),
            Err(BackgroundError::StorageFailed)
        );
        let source = temp.path().join("source.png");
        std::fs::write(&source, png_image(10, 10)).unwrap();
        assert_eq!(
            import_background_from_path(&source, temp.path()),
            Err(BackgroundError::StorageFailed)
        );
        assert_eq!(
            std::fs::read_dir(temp.path().join("backgrounds"))
                .unwrap()
                .count(),
            2
        );
        assert!(resolve_background_reference(temp.path(), &reference).is_ok());
    }

    #[test]
    fn cleanup_retains_pairs_and_removes_stale_pairs_and_orphan_thumbnails() {
        let temp = tempfile::tempdir().unwrap();
        let kept = legacy_image(temp.path(), &png_image(20, 10));
        resolve_background_resource(temp.path(), &kept, true, false).unwrap();
        let source = temp.path().join("source.png");
        std::fs::write(&source, png_image(40, 20)).unwrap();
        let stale = import_background_from_path(&source, temp.path()).unwrap();
        let orphan = "abcdefab-cdef-4abc-8def-abcdefabcdef.webp";
        let thumbnail_dir = temp.path().join("backgrounds/thumbnails");
        let orphan_path = thumbnail_dir.join(format!("{orphan}.png"));
        std::fs::write(&orphan_path, b"orphan").unwrap();
        std::fs::write(thumbnail_dir.join("unmanaged.png"), b"keep").unwrap();
        std::fs::write(thumbnail_dir.join(format!("{orphan}.png.extra")), b"keep").unwrap();
        let managed_directory = thumbnail_dir.join("abcdefab-cdef-4abc-9def-abcdefabcdef.jpg.png");
        std::fs::create_dir(&managed_directory).unwrap();
        cleanup_background_files(
            temp.path(),
            &[kept.clone(), format!("backgrounds/{orphan}")],
        )
        .unwrap();
        assert!(temp.path().join(&kept).exists());
        assert!(thumbnail_path(temp.path(), managed_file_name(&kept).unwrap()).exists());
        assert!(!stale.absolute_path.exists());
        assert!(
            !thumbnail_path(temp.path(), managed_file_name(&stale.reference).unwrap()).exists()
        );
        assert!(!orphan_path.exists());
        assert!(thumbnail_dir.join("unmanaged.png").exists());
        assert!(thumbnail_dir.join(format!("{orphan}.png.extra")).exists());
        assert!(managed_directory.is_dir());
        assert!(source.exists());
    }

    #[test]
    fn cleanup_handles_missing_backgrounds_and_never_accepts_thumbnail_references() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(cleanup_background_files(temp.path(), &[]), Ok(()));
        assert_eq!(
            cleanup_background_files(
                temp.path(),
                &[
                    "backgrounds/thumbnails/01234567-89ab-4cde-8fab-0123456789ab.png.png"
                        .to_owned()
                ]
            ),
            Err(BackgroundError::InvalidReference)
        );
        assert!(!temp.path().join("backgrounds").exists());
    }

    #[test]
    fn thumbnail_persist_failure_removes_the_temporary_file() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("occupied.png");
        std::fs::create_dir(&target).unwrap();
        assert_eq!(
            save_thumbnail(&DynamicImage::new_rgba8(20, 10), &target),
            Err(BackgroundError::StorageFailed)
        );
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn hot_reads_enforce_original_size_and_thumbnail_byte_limits() {
        let temp = tempfile::tempdir().unwrap();
        let reference = legacy_image(temp.path(), &png_image(20, 10));
        let resolved = resolve_background_resource(temp.path(), &reference, true, false).unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&resolved.absolute_path)
            .unwrap()
            .set_len(MAX_THUMBNAIL_BYTES + 1)
            .unwrap();
        resolve_background_resource(temp.path(), &reference, true, false).unwrap();
        assert!(std::fs::metadata(&resolved.absolute_path).unwrap().len() < MAX_THUMBNAIL_BYTES);
        std::fs::OpenOptions::new()
            .write(true)
            .open(temp.path().join(&reference))
            .unwrap()
            .set_len(MAX_BACKGROUND_BYTES + 1)
            .unwrap();
        assert_eq!(
            resolve_background_resource(temp.path(), &reference, true, false),
            Err(BackgroundError::TooLarge)
        );
        std::fs::write(temp.path().join(&reference), b"").unwrap();
        assert_eq!(
            resolve_background_resource(temp.path(), &reference, true, false),
            Err(BackgroundError::Corrupt)
        );
    }

    #[test]
    fn rejects_backgrounds_larger_than_twenty_decimal_megabytes() {
        assert_eq!(MAX_BACKGROUND_BYTES, 20_000_000);
        assert_eq!(validate_background_size(MAX_BACKGROUND_BYTES), Ok(()));
        assert_eq!(
            validate_background_size(MAX_BACKGROUND_BYTES + 1),
            Err(BackgroundError::TooLarge)
        );
    }

    #[test]
    fn accepts_a_decodable_png_by_content() {
        let png = include_bytes!("../icons/32x32.png");

        assert_eq!(validate_background_bytes(png), Ok(BackgroundKind::Png));
    }

    #[test]
    fn accepts_decodable_jpeg_and_webp_content() {
        let image = image::DynamicImage::new_rgb8(2, 2);
        for (format, expected) in [
            (ImageFormat::Jpeg, BackgroundKind::Jpeg),
            (ImageFormat::WebP, BackgroundKind::WebP),
        ] {
            let mut output = Cursor::new(Vec::new());
            image
                .write_to(&mut output, format)
                .expect("encode supported image");
            assert_eq!(
                validate_background_bytes(&output.into_inner()),
                Ok(expected)
            );
        }
    }

    #[test]
    fn rejects_unsupported_and_corrupt_image_content() {
        assert_eq!(
            validate_background_bytes(b"GIF89a"),
            Err(BackgroundError::UnsupportedType)
        );
        assert_eq!(
            validate_background_bytes(b"\x89PNG\r\n\x1a\ntruncated"),
            Err(BackgroundError::Corrupt)
        );
    }

    #[test]
    fn accepts_only_managed_relative_resource_references() {
        let reference = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.webp";

        assert_eq!(
            managed_file_name(reference),
            Ok("01234567-89ab-4cde-8fab-0123456789ab.webp")
        );
        assert_eq!(
            managed_file_name("../wallpaper.png"),
            Err(BackgroundError::InvalidReference)
        );
        assert_eq!(
            managed_file_name("C:\\Users\\someone\\wallpaper.png"),
            Err(BackgroundError::InvalidReference)
        );
    }

    #[test]
    fn imports_a_copy_without_changing_the_original_file() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let source = temp.path().join("chosen-wallpaper.png");
        let app_data = temp.path().join("app-data");
        let png = include_bytes!("../icons/32x32.png");
        std::fs::write(&source, png).expect("write source image");

        let imported = import_background_from_path(&source, &app_data).expect("import image");

        assert!(source.exists());
        assert!(imported.reference.starts_with("backgrounds/"));
        assert!(imported.reference.ends_with(".png"));
        assert_eq!(std::fs::read(&source).expect("read source"), png);
        assert_eq!(
            std::fs::read(&imported.absolute_path).expect("read imported copy"),
            png
        );
        assert_eq!(
            imported.absolute_path.parent(),
            Some(app_data.join("backgrounds").as_path())
        );
        std::fs::remove_file(&source).expect("remove original after import");
        assert!(resolve_background_reference(&app_data, &imported.reference).is_ok());
    }

    #[test]
    fn cleanup_removes_only_unreferenced_managed_private_copies() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let backgrounds = temp.path().join("backgrounds");
        std::fs::create_dir_all(&backgrounds).expect("create backgrounds directory");
        let retained = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";
        let stale = "backgrounds/abcdefab-cdef-4abc-8def-abcdefabcdef.webp";
        std::fs::write(
            backgrounds.join(managed_file_name(retained).expect("retained name")),
            b"retained",
        )
        .expect("write retained copy");
        std::fs::write(
            backgrounds.join(managed_file_name(stale).expect("stale name")),
            b"stale",
        )
        .expect("write stale copy");
        std::fs::write(backgrounds.join("unmanaged-note.txt"), b"leave me")
            .expect("write unmanaged file");

        cleanup_background_files(temp.path(), &[retained.to_owned()]).expect("cleanup files");

        assert!(
            backgrounds
                .join(managed_file_name(retained).unwrap())
                .exists()
        );
        assert!(!backgrounds.join(managed_file_name(stale).unwrap()).exists());
        assert!(backgrounds.join("unmanaged-note.txt").exists());
    }

    #[test]
    fn resolving_a_missing_or_corrupt_private_copy_fails_safely() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let reference = "backgrounds/01234567-89ab-4cde-8fab-0123456789ab.png";

        assert_eq!(
            resolve_background_reference(temp.path(), reference),
            Err(BackgroundError::Unavailable)
        );

        let backgrounds = temp.path().join("backgrounds");
        std::fs::create_dir_all(&backgrounds).expect("create backgrounds directory");
        std::fs::write(
            backgrounds.join(managed_file_name(reference).unwrap()),
            b"\x89PNG\r\n\x1a\ntruncated",
        )
        .expect("write corrupt copy");

        assert_eq!(
            resolve_background_reference(temp.path(), reference),
            Err(BackgroundError::Corrupt)
        );
    }
}
