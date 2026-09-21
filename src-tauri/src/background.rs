use std::{
    collections::HashSet,
    fs::OpenOptions,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

use image::{ImageFormat, ImageReader, Limits};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub const MAX_BACKGROUND_BYTES: u64 = 20_000_000;

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

fn validate_background_bytes(bytes: &[u8]) -> Result<BackgroundKind, BackgroundError> {
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
    reader.decode().map_err(|_| BackgroundError::Corrupt)?;
    Ok(kind)
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
    let metadata = std::fs::metadata(source).map_err(|_| BackgroundError::Unavailable)?;
    if !metadata.is_file() {
        return Err(BackgroundError::Unavailable);
    }
    validate_background_size(metadata.len())?;
    let bytes = std::fs::read(source).map_err(|_| BackgroundError::Unavailable)?;
    let kind = validate_background_bytes(&bytes)?;

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

    Ok(ImportedBackground {
        reference: format!("backgrounds/{file_name}"),
        absolute_path,
    })
}

fn cleanup_background_files(
    app_data_dir: &Path,
    retained_references: &[String],
) -> Result<(), BackgroundError> {
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
    Ok(())
}

fn resolve_background_reference(
    app_data_dir: &Path,
    reference: &str,
) -> Result<ImportedBackground, BackgroundError> {
    let file_name = managed_file_name(reference)?;
    let absolute_path = app_data_dir.join("backgrounds").join(file_name);
    let metadata = std::fs::metadata(&absolute_path).map_err(|_| BackgroundError::Unavailable)?;
    if !metadata.is_file() {
        return Err(BackgroundError::Unavailable);
    }
    validate_background_size(metadata.len())?;
    let bytes = std::fs::read(&absolute_path).map_err(|_| BackgroundError::Unavailable)?;
    let kind = validate_background_bytes(&bytes)?;
    if !file_name.ends_with(&format!(".{}", kind.extension())) {
        return Err(BackgroundError::Corrupt);
    }
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
    let imported = import_background_from_path(&source, &app_data_dir(&app)?)
        .map_err(|error| error.code().to_owned())?;
    BackgroundResourcePayload::try_from(imported).map(Some)
}

#[tauri::command]
pub fn resolve_background_image(
    app: AppHandle,
    reference: String,
) -> Result<BackgroundResourcePayload, String> {
    let resource = resolve_background_reference(&app_data_dir(&app)?, &reference)
        .map_err(|error| error.code().to_owned())?;
    BackgroundResourcePayload::try_from(resource)
}

#[tauri::command]
pub fn cleanup_background_images(
    app: AppHandle,
    retained_references: Vec<String>,
) -> Result<(), String> {
    cleanup_background_files(&app_data_dir(&app)?, &retained_references)
        .map_err(|error| error.code().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

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
