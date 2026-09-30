//! Private, bounded drawing originals with a manifest as the publication boundary.
use std::{
    collections::HashSet,
    fs::{Metadata, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use uuid::{Uuid, Variant, Version};

const IMAGE_LIMIT: usize = 32 * 1024 * 1024;
const TOTAL_LIMIT: usize = 64 * 1024 * 1024;
const PIXEL_LIMIT: u64 = 32_000_000;
const IMAGE_COUNT: usize = 8;
const MANIFEST_LIMIT: usize = 16 * 1024;
static DRAWING_FILES: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq)]
enum Error {
    InvalidReference,
    TooLarge,
    Corrupt,
    Collision,
    Unavailable,
    Storage,
}
impl Error {
    fn code(&self) -> String {
        match self {
            Self::InvalidReference => "drawing-invalid-reference",
            Self::TooLarge => "drawing-too-large",
            Self::Corrupt => "drawing-corrupt",
            Self::Collision => "drawing-task-collision",
            Self::Unavailable => "drawing-unavailable",
            Self::Storage => "drawing-storage",
        }
        .to_owned()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DrawingImageInput {
    mime: String,
    data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DrawingFile {
    id: String,
    reference: String,
    mime: String,
    size: usize,
    width: u32,
    height: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u8,
    files: Vec<DrawingFile>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PendingFile {
    file: DrawingFile,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    version: u8,
    files: Vec<PendingFile>,
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn uuid(value: &str) -> Result<(), Error> {
    let parsed = Uuid::parse_str(value).map_err(|_| Error::InvalidReference)?;
    if parsed.get_version() != Some(Version::Random)
        || parsed.get_variant() != Variant::RFC4122
        || parsed.hyphenated().to_string() != value
    {
        return Err(Error::InvalidReference);
    }
    Ok(())
}

fn reference(value: &str) -> Result<(&str, &str, &str), Error> {
    let suffix = value
        .strip_prefix("drawing/")
        .ok_or(Error::InvalidReference)?;
    let (task, name) = suffix.split_once('/').ok_or(Error::InvalidReference)?;
    let (id, ext) = name.rsplit_once('.').ok_or(Error::InvalidReference)?;
    uuid(task)?;
    uuid(id)?;
    if !matches!(ext, "png" | "jpg" | "webp") {
        return Err(Error::InvalidReference);
    }
    Ok((task, id, ext))
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

// Inspect ancestors before creating/opening, and reject Windows reparse points.
fn inspect(path: &Path) -> Result<Option<Metadata>, Error> {
    if !path.is_absolute() {
        return Err(Error::InvalidReference);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir | Component::CurDir) {
            return Err(Error::InvalidReference);
        }
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

fn bounded_read(path: &Path, limit: usize) -> Result<Vec<u8>, Error> {
    let metadata = inspect(path)?.ok_or(Error::Unavailable)?;
    if !metadata.is_file() {
        return Err(Error::InvalidReference);
    }
    if metadata.len() > limit as u64 {
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
    if metadata.len() > limit as u64 {
        return Err(Error::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Storage)?;
    if bytes.len() > limit {
        return Err(Error::TooLarge);
    }
    Ok(bytes)
}

fn kind(mime: &str) -> Result<(ImageFormat, &'static str), Error> {
    match mime {
        "image/png" => Ok((ImageFormat::Png, "png")),
        "image/jpeg" => Ok((ImageFormat::Jpeg, "jpg")),
        "image/webp" => Ok((ImageFormat::WebP, "webp")),
        _ => Err(Error::Corrupt),
    }
}

fn decode_image(bytes: &[u8], mime: &str) -> Result<DynamicImage, Error> {
    if bytes.len() > IMAGE_LIMIT {
        return Err(Error::TooLarge);
    }
    let (format, _) = kind(mime)?;
    if image::guess_format(bytes).map_err(|_| Error::Corrupt)? != format {
        return Err(Error::Corrupt);
    }
    let mut header = ImageReader::with_format(Cursor::new(bytes), format);
    let mut header_limits = Limits::default();
    header_limits.max_alloc = Some(256 * 1024 * 1024);
    header.limits(header_limits);
    let (width, height) = header.into_dimensions().map_err(|_| Error::Corrupt)?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > PIXEL_LIMIT {
        return Err(Error::TooLarge);
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(width);
    limits.max_image_height = Some(height);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    reader.decode().map_err(|_| Error::Corrupt)
}

fn decode_inputs(images: &[DrawingImageInput]) -> Result<Vec<Vec<u8>>, Error> {
    if images.is_empty() || images.len() > IMAGE_COUNT {
        return Err(Error::TooLarge);
    }
    let mut total = 0usize;
    let mut decoded = Vec::with_capacity(images.len());
    for image in images {
        kind(&image.mime)?;
        if image.data.len() > IMAGE_LIMIT.div_ceil(3) * 4 {
            return Err(Error::TooLarge);
        }
        let bytes = STANDARD.decode(&image.data).map_err(|_| Error::Corrupt)?;
        if bytes.len() > IMAGE_LIMIT {
            return Err(Error::TooLarge);
        }
        total += bytes.len();
        if total > TOTAL_LIMIT {
            return Err(Error::TooLarge);
        }
        decode_image(&bytes, &image.mime)?;
        decoded.push(bytes);
    }
    Ok(decoded)
}

fn task_directory(root: &Path, task: &str) -> Result<PathBuf, Error> {
    uuid(task)?;
    let path = root.join("drawing").join(task);
    inspect(&path)?;
    Ok(path)
}

fn validate_descriptors<'a>(
    task: &str,
    files: impl IntoIterator<Item = &'a DrawingFile>,
) -> Result<(), Error> {
    let files = files.into_iter().collect::<Vec<_>>();
    if files.is_empty() || files.len() > IMAGE_COUNT {
        return Err(Error::Corrupt);
    }
    let mut references = HashSet::new();
    let mut ids = HashSet::new();
    let mut total = 0usize;
    for item in files {
        let (reference_task, id, ext) = reference(&item.reference)?;
        if reference_task != task
            || id != item.id
            || kind(&item.mime)?.1 != ext
            || !references.insert(&item.reference)
            || !ids.insert(&item.id)
        {
            return Err(Error::Corrupt);
        }
        total = total.checked_add(item.size).ok_or(Error::TooLarge)?;
        if item.size > IMAGE_LIMIT
            || total > TOTAL_LIMIT
            || u64::from(item.width) * u64::from(item.height) > PIXEL_LIMIT
        {
            return Err(Error::TooLarge);
        }
        if item.size == 0 || item.width == 0 || item.height == 0 {
            return Err(Error::Corrupt);
        }
    }
    Ok(())
}

fn verify_bytes(item: &DrawingFile, bytes: &[u8]) -> Result<(), Error> {
    let image = decode_image(bytes, &item.mime)?;
    if bytes.len() != item.size || image.width() != item.width || image.height() != item.height {
        return Err(Error::Corrupt);
    }
    Ok(())
}

fn read_manifest(root: &Path, task: &str) -> Result<Option<Vec<DrawingFile>>, Error> {
    let directory = task_directory(root, task)?;
    let manifest_path = directory.join("manifest.json");
    if inspect(&manifest_path)?.is_none() {
        return Ok(None);
    }
    let manifest: Manifest = serde_json::from_slice(&bounded_read(&manifest_path, MANIFEST_LIMIT)?)
        .map_err(|_| Error::Corrupt)?;
    if manifest.version != 1 {
        return Err(Error::Corrupt);
    }
    validate_descriptors(task, &manifest.files)?;
    for item in &manifest.files {
        verify_bytes(
            item,
            &bounded_read(&root.join(&item.reference), IMAGE_LIMIT)?,
        )?;
    }
    Ok(Some(manifest.files))
}

fn read_pending(root: &Path, task: &str) -> Result<Option<Pending>, Error> {
    let path = task_directory(root, task)?.join("pending.json");
    if inspect(&path)?.is_none() {
        return Ok(None);
    }
    let pending: Pending = serde_json::from_slice(&bounded_read(&path, MANIFEST_LIMIT)?)
        .map_err(|_| Error::Corrupt)?;
    if pending.version != 1 {
        return Err(Error::Corrupt);
    }
    validate_descriptors(task, pending.files.iter().map(|item| &item.file))?;
    for item in &pending.files {
        if item.sha256.len() != 64
            || !item
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(Error::Corrupt);
        }
    }
    Ok(Some(pending))
}

fn verify_pending_file(root: &Path, item: &PendingFile) -> Result<bool, Error> {
    let path = root.join(&item.file.reference);
    if inspect(&path)?.is_none() {
        return Ok(false);
    }
    let bytes = bounded_read(&path, IMAGE_LIMIT)?;
    if sha256(&bytes) != item.sha256 {
        return Err(Error::Corrupt);
    }
    verify_bytes(&item.file, &bytes)?;
    Ok(true)
}

fn publish_manifest(directory: &Path, files: &[DrawingFile]) -> Result<(), Error> {
    let manifest = serde_json::to_vec(&Manifest {
        version: 1,
        files: files.to_vec(),
    })
    .map_err(|_| Error::Storage)?;
    publish(&directory.join("manifest.json"), &manifest)
}

fn recover(root: &Path, task: &str) -> Result<Option<Vec<DrawingFile>>, Error> {
    if let Some(files) = read_manifest(root, task)? {
        return Ok(Some(files));
    }
    let Some(pending) = read_pending(root, task)? else {
        return Ok(None);
    };
    let mut complete = true;
    // Validate every existing original even if another planned file is missing.
    for item in &pending.files {
        if !verify_pending_file(root, item)? {
            complete = false;
        }
    }
    if !complete {
        return Ok(None);
    }
    let files = pending
        .files
        .into_iter()
        .map(|item| item.file)
        .collect::<Vec<_>>();
    publish_manifest(&task_directory(root, task)?, &files)?;
    Ok(Some(files))
}

fn plan(task: &str, images: &[DrawingImageInput], bytes: &[Vec<u8>]) -> Result<Pending, Error> {
    let mut files = Vec::with_capacity(images.len());
    for (input, bytes) in images.iter().zip(bytes) {
        let image = decode_image(bytes, &input.mime)?;
        let id = Uuid::new_v4().to_string();
        let filename = format!("{id}.{}", kind(&input.mime)?.1);
        files.push(PendingFile {
            file: DrawingFile {
                id,
                reference: format!("drawing/{task}/{filename}"),
                mime: input.mime.clone(),
                size: bytes.len(),
                width: image.width(),
                height: image.height(),
            },
            sha256: sha256(bytes),
        });
    }
    Ok(Pending { version: 1, files })
}

// No replacement of originals or published manifests. Files are fully flushed
// before their names become visible; pending.json keeps every planned original
// recoverable if a crash interrupts the final manifest publication.
fn publish(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    if inspect(path)?.is_some() {
        return Err(Error::Collision);
    }
    let parent = path.parent().ok_or(Error::Storage)?;
    if !inspect(parent)?.is_some_and(|metadata| metadata.is_dir()) {
        return Err(Error::Storage);
    }
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::Storage)?;
    file.write_all(bytes).map_err(|_| Error::Storage)?;
    file.flush().map_err(|_| Error::Storage)?;
    file.as_file().sync_all().map_err(|_| Error::Storage)?;
    let file = file.persist_noclobber(path).map_err(|_| Error::Storage)?;
    file.sync_all().map_err(|_| Error::Storage)?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| Error::Storage)?;
    Ok(())
}

fn save(root: &Path, task: &str, images: &[DrawingImageInput]) -> Result<Vec<DrawingFile>, Error> {
    save_with_manifest_publisher(root, task, images, publish_manifest)
}

fn save_with_manifest_publisher(
    root: &Path,
    task: &str,
    images: &[DrawingImageInput],
    publish_manifest: impl FnOnce(&Path, &[DrawingFile]) -> Result<(), Error>,
) -> Result<Vec<DrawingFile>, Error> {
    let directory = task_directory(root, task)?;
    let bytes = decode_inputs(images)?;
    if let Some(files) = read_manifest(root, task)? {
        if files.len() != images.len() {
            return Err(Error::Collision);
        }
        for ((item, image), bytes) in files.iter().zip(images).zip(&bytes) {
            if item.mime != image.mime
                || bounded_read(&root.join(&item.reference), IMAGE_LIMIT)? != *bytes
            {
                return Err(Error::Collision);
            }
        }
        return Ok(files);
    }
    std::fs::create_dir_all(&directory).map_err(|_| Error::Storage)?;
    inspect(&directory)?;
    let pending = if let Some(pending) = read_pending(root, task)? {
        if pending.files.len() != images.len() {
            return Err(Error::Collision);
        }
        for ((item, image), bytes) in pending.files.iter().zip(images).zip(&bytes) {
            if item.file.mime != image.mime
                || item.sha256 != sha256(bytes)
                || item.file.size != bytes.len()
            {
                return Err(Error::Collision);
            }
            verify_bytes(&item.file, bytes)?;
        }
        pending
    } else {
        let pending = plan(task, images, &bytes)?;
        let receipt = serde_json::to_vec(&pending).map_err(|_| Error::Storage)?;
        publish(&directory.join("pending.json"), &receipt)?;
        pending
    };
    // Check all existing files before filling gaps; never overwrite a corrupt one.
    let existing = pending
        .files
        .iter()
        .map(|item| verify_pending_file(root, item))
        .collect::<Result<Vec<_>, _>>()?;
    for ((item, bytes), exists) in pending.files.iter().zip(&bytes).zip(existing) {
        if !exists {
            publish(&root.join(&item.file.reference), bytes)?;
        }
    }
    let files = pending
        .files
        .into_iter()
        .map(|item| item.file)
        .collect::<Vec<_>>();
    publish_manifest(&directory, &files)?;
    Ok(files)
}

fn read(root: &Path, value: &str) -> Result<DrawingImageInput, Error> {
    let (task, _, _) = reference(value)?;
    let files = read_manifest(root, task)?.ok_or(Error::Unavailable)?;
    let item = files
        .iter()
        .find(|item| item.reference == value)
        .ok_or(Error::Unavailable)?;
    Ok(DrawingImageInput {
        mime: item.mime.clone(),
        data: STANDARD.encode(bounded_read(&root.join(value), IMAGE_LIMIT)?),
    })
}

fn export_png(root: &Path, value: &str, destination: &Path) -> Result<(), Error> {
    let input = read(root, value)?;
    let bytes = STANDARD.decode(input.data).map_err(|_| Error::Corrupt)?;
    let image = decode_image(&bytes, &input.mime)?;
    // Encoding fresh pixels never copies EXIF, text, XMP or generation metadata.
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| Error::Storage)?;
    if inspect(destination)?.is_some_and(|metadata| !metadata.is_file()) {
        return Err(Error::InvalidReference);
    }
    let parent = destination.parent().ok_or(Error::InvalidReference)?;
    if !inspect(parent)?.is_some_and(|metadata| metadata.is_dir()) {
        return Err(Error::InvalidReference);
    }
    let root = root.canonicalize().map_err(|_| Error::Storage)?;
    let parent = parent.canonicalize().map_err(|_| Error::Storage)?;
    #[cfg(windows)]
    let private_destination = parent
        .to_string_lossy()
        .to_lowercase()
        .starts_with(&format!("{}\\", root.to_string_lossy().to_lowercase()))
        || parent
            .to_string_lossy()
            .eq_ignore_ascii_case(&root.to_string_lossy());
    #[cfg(not(windows))]
    let private_destination = parent.starts_with(&root);
    if private_destination {
        return Err(Error::InvalidReference);
    }
    let mut output = tempfile::NamedTempFile::new_in(&parent).map_err(|_| Error::Storage)?;
    output
        .write_all(png.get_ref())
        .map_err(|_| Error::Storage)?;
    output.flush().map_err(|_| Error::Storage)?;
    output.as_file().sync_all().map_err(|_| Error::Storage)?;
    output.persist(destination).map_err(|_| Error::Storage)?;
    Ok(())
}

fn app_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| Error::Storage.code())
}

#[tauri::command]
pub async fn save_drawing_result(
    app: AppHandle,
    task_id: String,
    images: Vec<DrawingImageInput>,
) -> Result<Vec<DrawingFile>, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        save(&root, &task_id, &images).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn recover_drawing_result(
    app: AppHandle,
    task_id: String,
) -> Result<Option<Vec<DrawingFile>>, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        recover(&root, &task_id).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn read_drawing_result(
    app: AppHandle,
    reference: String,
) -> Result<DrawingImageInput, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        read(&root, &reference).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn export_drawing_result(app: AppHandle, reference: String) -> Result<bool, String> {
    let root = app_directory(&app)?;
    self::reference(&reference).map_err(|error| error.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("PNG image", &["png"])
            .set_file_name("Ayase-drawing.png")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let destination = file
            .into_path()
            .map_err(|_| Error::InvalidReference.code())?;
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        export_png(&root, &reference, &destination)
            .map(|_| true)
            .map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(color: u8, format: ImageFormat) -> DrawingImageInput {
        let image = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            3,
            2,
            image::Rgb([color, 40, 90]),
        ));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        let mime = match format {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::WebP => "image/webp",
            _ => unreachable!(),
        };
        DrawingImageInput {
            mime: mime.to_owned(),
            data: STANDARD.encode(bytes.into_inner()),
        }
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut value = !0u32;
        for byte in bytes {
            value ^= u32::from(*byte);
            for _ in 0..8 {
                value = (value >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(value & 1));
            }
        }
        !value
    }

    fn png_chunk(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut chunk = (data.len() as u32).to_be_bytes().to_vec();
        chunk.extend_from_slice(name);
        chunk.extend_from_slice(data);
        let checksum = crc32(&chunk[4..]);
        chunk.extend_from_slice(&checksum.to_be_bytes());
        chunk
    }

    #[test]
    fn saves_multiple_formats_recovers_reads_and_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        assert_eq!(read_manifest(root.path(), &task).unwrap(), None);
        let images = [
            input(20, ImageFormat::Png),
            input(30, ImageFormat::Jpeg),
            input(40, ImageFormat::WebP),
        ];
        let files = save(root.path(), &task, &images).unwrap();
        assert_eq!(files.len(), 3);
        assert_eq!(
            read_manifest(root.path(), &task).unwrap(),
            Some(files.clone())
        );
        assert_eq!(save(root.path(), &task, &images).unwrap(), files);
        for (file, image) in files.iter().zip(&images) {
            assert_eq!((file.width, file.height), (3, 2));
            let read = read(root.path(), &file.reference).unwrap();
            assert_eq!(read.data, image.data);
            assert_eq!(read.mime, image.mime);
        }
        let manifest =
            std::fs::read_to_string(root.path().join("drawing").join(task).join("manifest.json"))
                .unwrap();
        assert!(!manifest.contains("prompt"));
        assert!(!manifest.contains("parameters"));
        assert!(!manifest.contains("data"));
    }

    #[test]
    fn collision_never_overwrites_published_results() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        assert_eq!(
            save(root.path(), &task, &[input(90, ImageFormat::Png)]).unwrap_err(),
            Error::Collision
        );
        assert_eq!(
            save(
                root.path(),
                &task,
                &[input(20, ImageFormat::Png), input(90, ImageFormat::Png)]
            )
            .unwrap_err(),
            Error::Collision
        );
        assert_eq!(
            read_manifest(root.path(), &task).unwrap(),
            Some(files.clone())
        );
        assert_eq!(
            read(root.path(), &files[0].reference).unwrap().data,
            input(20, ImageFormat::Png).data
        );
    }

    fn receipt(root: &Path, task: &str, images: &[DrawingImageInput]) -> (Pending, Vec<Vec<u8>>) {
        let bytes = decode_inputs(images).unwrap();
        let pending = plan(task, images, &bytes).unwrap();
        let directory = task_directory(root, task).unwrap();
        std::fs::create_dir_all(&directory).unwrap();
        publish(
            &directory.join("pending.json"),
            &serde_json::to_vec(&pending).unwrap(),
        )
        .unwrap();
        (pending, bytes)
    }

    #[test]
    fn complete_pending_originals_recover_without_payload_or_manifest() {
        for images in [
            vec![input(20, ImageFormat::Png)],
            vec![input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)],
        ] {
            let root = tempfile::tempdir().unwrap();
            let task = Uuid::new_v4().to_string();
            let (pending, bytes) = receipt(root.path(), &task, &images);
            for (item, bytes) in pending.files.iter().zip(bytes) {
                publish(&root.path().join(&item.file.reference), &bytes).unwrap();
            }
            assert_eq!(read_manifest(root.path(), &task).unwrap(), None);
            let expected = pending
                .files
                .into_iter()
                .map(|item| item.file)
                .collect::<Vec<_>>();
            assert_eq!(recover(root.path(), &task).unwrap(), Some(expected.clone()));
            assert_eq!(recover(root.path(), &task).unwrap(), Some(expected.clone()));
            assert_eq!(save(root.path(), &task, &images).unwrap(), expected);
            assert_eq!(
                std::fs::read_dir(task_directory(root.path(), &task).unwrap())
                    .unwrap()
                    .count(),
                images.len() + 2
            );
        }
    }

    #[test]
    fn pending_subset_remains_unpublished_then_matching_save_reuses_every_uuid() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        let first_path = root.path().join(&pending.files[0].file.reference);
        publish(&first_path, &bytes[0]).unwrap();
        let modified = std::fs::metadata(&first_path).unwrap().modified().unwrap();
        let pending_path = task_directory(root.path(), &task)
            .unwrap()
            .join("pending.json");
        let original_receipt = std::fs::read(&pending_path).unwrap();
        assert_eq!(recover(root.path(), &task).unwrap(), None);
        assert_eq!(read_manifest(root.path(), &task).unwrap(), None);
        assert!(matches!(
            read(root.path(), &pending.files[0].file.reference),
            Err(Error::Unavailable)
        ));
        let expected = pending
            .files
            .into_iter()
            .map(|item| item.file)
            .collect::<Vec<_>>();
        assert_eq!(save(root.path(), &task, &images).unwrap(), expected);
        assert_eq!(save(root.path(), &task, &images).unwrap(), expected);
        assert_eq!(
            std::fs::metadata(first_path).unwrap().modified().unwrap(),
            modified
        );
        assert_eq!(std::fs::read(pending_path).unwrap(), original_receipt);
        assert_eq!(
            std::fs::read_dir(task_directory(root.path(), &task).unwrap())
                .unwrap()
                .count(),
            4
        );
    }

    #[test]
    fn pending_payload_collision_preserves_receipt_and_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        publish(
            &root.path().join(&pending.files[0].file.reference),
            &bytes[0],
        )
        .unwrap();
        for conflicting in [
            vec![input(21, ImageFormat::Png), input(30, ImageFormat::Jpeg)],
            vec![input(20, ImageFormat::Png)],
            vec![input(20, ImageFormat::Png), input(30, ImageFormat::WebP)],
        ] {
            assert_eq!(
                save(root.path(), &task, &conflicting).unwrap_err(),
                Error::Collision
            );
            assert_eq!(recover(root.path(), &task).unwrap(), None);
            assert_eq!(
                std::fs::read_dir(task_directory(root.path(), &task).unwrap())
                    .unwrap()
                    .count(),
                2
            );
        }
        assert_eq!(
            std::fs::read(root.path().join(&pending.files[0].file.reference)).unwrap(),
            bytes[0]
        );
    }

    #[test]
    fn corrupt_pending_or_original_cannot_recover_or_be_replaced() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)];
        let (mut pending, bytes) = receipt(root.path(), &task, &images);
        let path = task_directory(root.path(), &task)
            .unwrap()
            .join("pending.json");
        let encoded = serde_json::to_vec(&pending).unwrap();
        pending.files[0].sha256 = "z".repeat(64);
        std::fs::write(&path, serde_json::to_vec(&pending).unwrap()).unwrap();
        assert_eq!(recover(root.path(), &task).unwrap_err(), Error::Corrupt);
        assert_eq!(
            save(root.path(), &task, &images).unwrap_err(),
            Error::Corrupt
        );
        std::fs::write(&path, &encoded).unwrap();
        let original = root.path().join(&pending.files[0].file.reference);
        let changed = STANDARD.decode(input(99, ImageFormat::Png).data).unwrap();
        publish(&original, &changed).unwrap();
        assert_eq!(recover(root.path(), &task).unwrap_err(), Error::Corrupt);
        assert_eq!(
            save(root.path(), &task, &images).unwrap_err(),
            Error::Corrupt
        );
        assert_eq!(std::fs::read(&original).unwrap(), changed);
        assert!(!root.path().join(&pending.files[1].file.reference).exists());
        std::fs::write(&original, &bytes[0]).unwrap();
        for (name, value) in [
            ("version", serde_json::json!(2)),
            ("files", serde_json::json!([])),
        ] {
            let mut invalid: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
            invalid[name] = value;
            std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert_eq!(recover(root.path(), &task).unwrap_err(), Error::Corrupt);
        }
        std::fs::write(&path, "x".repeat(MANIFEST_LIMIT + 1)).unwrap();
        assert_eq!(recover(root.path(), &task).unwrap_err(), Error::TooLarge);
        assert!(
            !task_directory(root.path(), &task)
                .unwrap()
                .join("manifest.json")
                .exists()
        );
    }

    #[test]
    fn manifest_publication_failure_recovers_receipted_files_without_new_attempts() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::WebP)];
        assert_eq!(
            save_with_manifest_publisher(root.path(), &task, &images, |_, _| Err(Error::Storage))
                .unwrap_err(),
            Error::Storage
        );
        let pending = read_pending(root.path(), &task).unwrap().unwrap();
        let files = pending
            .files
            .into_iter()
            .map(|item| item.file)
            .collect::<Vec<_>>();
        assert_eq!(read_manifest(root.path(), &task).unwrap(), None);
        assert_eq!(recover(root.path(), &task).unwrap(), Some(files.clone()));
        assert_eq!(save(root.path(), &task, &images).unwrap(), files);
        assert_eq!(
            std::fs::read_dir(task_directory(root.path(), &task).unwrap())
                .unwrap()
                .count(),
            4
        );
    }

    #[test]
    fn pending_descriptor_budgets_and_managed_paths_are_checked_before_recovery() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let (pending, _) = receipt(root.path(), &task, &[input(20, ImageFormat::Png)]);
        let path = task_directory(root.path(), &task)
            .unwrap()
            .join("pending.json");
        let encoded = serde_json::to_value(&pending).unwrap();
        for (name, value, error) in [
            (
                "reference",
                serde_json::json!("drawing/../outside.png"),
                Error::InvalidReference,
            ),
            ("mime", serde_json::json!("image/jpeg"), Error::Corrupt),
            (
                "id",
                serde_json::json!(Uuid::new_v4().to_string()),
                Error::Corrupt,
            ),
            ("size", serde_json::json!(IMAGE_LIMIT + 1), Error::TooLarge),
            ("width", serde_json::json!(32_000_001), Error::TooLarge),
            ("height", serde_json::json!(0), Error::Corrupt),
        ] {
            let mut invalid = encoded.clone();
            invalid["files"][0]["file"][name] = value;
            std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert_eq!(recover(root.path(), &task).unwrap_err(), error);
        }
        assert!(!path.parent().unwrap().join("manifest.json").exists());
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }

    #[test]
    fn corrupt_inputs_and_partial_attempts_never_publish_a_manifest() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let invalid = DrawingImageInput {
            mime: "image/png".into(),
            data: "not base64!".into(),
        };
        assert_eq!(
            save(root.path(), &task, &[input(20, ImageFormat::Png), invalid]).unwrap_err(),
            Error::Corrupt
        );
        assert_eq!(read_manifest(root.path(), &task).unwrap(), None);
        let directory = task_directory(root.path(), &task).unwrap();
        std::fs::create_dir_all(&directory).unwrap();
        let old_name = format!("{}.png", Uuid::new_v4());
        let old_bytes = STANDARD.decode(input(40, ImageFormat::Png).data).unwrap();
        publish(&directory.join(&old_name), &old_bytes).unwrap();
        assert_eq!(read_manifest(root.path(), &task).unwrap(), None);
        assert!(matches!(
            read(root.path(), &format!("drawing/{task}/{old_name}")),
            Err(Error::Unavailable)
        ));
        save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        assert_eq!(std::fs::read(directory.join(old_name)).unwrap(), old_bytes);
    }

    #[test]
    fn rejects_wrong_mime_bad_content_and_encoded_size_before_decode() {
        let mut wrong = input(20, ImageFormat::Png);
        wrong.mime = "image/jpeg".into();
        assert!(matches!(decode_inputs(&[wrong]), Err(Error::Corrupt)));
        let mut wrong = input(20, ImageFormat::Png);
        wrong.mime = "image/svg+xml".into();
        assert!(matches!(decode_inputs(&[wrong]), Err(Error::Corrupt)));
        let wrong = DrawingImageInput {
            mime: "image/png".into(),
            data: STANDARD.encode("not an image"),
        };
        assert!(matches!(decode_inputs(&[wrong]), Err(Error::Corrupt)));
        let huge = DrawingImageInput {
            mime: "image/png".into(),
            data: "A".repeat(IMAGE_LIMIT.div_ceil(3) * 4 + 1),
        };
        assert!(matches!(decode_inputs(&[huge]), Err(Error::TooLarge)));
        assert!(matches!(decode_inputs(&[]), Err(Error::TooLarge)));
        let many = (0..9)
            .map(|_| input(20, ImageFormat::Png))
            .collect::<Vec<_>>();
        assert!(matches!(decode_inputs(&many), Err(Error::TooLarge)));
    }

    #[test]
    fn rejects_total_bytes_and_dimensions_before_pixel_decode() {
        let mut oversized_dimensions = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        oversized_dimensions[16..20].copy_from_slice(&8000u32.to_be_bytes());
        oversized_dimensions[20..24].copy_from_slice(&4001u32.to_be_bytes());
        let checksum = crc32(&oversized_dimensions[12..29]);
        oversized_dimensions[29..33].copy_from_slice(&checksum.to_be_bytes());
        assert!(matches!(
            decode_image(&oversized_dimensions, "image/png"),
            Err(Error::TooLarge)
        ));
        let mut bytes = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        bytes.resize(23 * 1024 * 1024, 0);
        let images = (0..3)
            .map(|_| DrawingImageInput {
                mime: "image/png".into(),
                data: STANDARD.encode(&bytes),
            })
            .collect::<Vec<_>>();
        assert!(matches!(decode_inputs(&images), Err(Error::TooLarge)));
    }

    #[test]
    fn rejects_noncanonical_uuids_traversal_and_unpublished_references() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let image = Uuid::new_v4().to_string();
        for value in [
            format!("drawing/../{image}.png"),
            format!("drawing/{task}/../{image}.png"),
            format!("drawing/{task}/{image}.PNG"),
            format!("drawing/{task}/{image}.png/other"),
            format!("drawing\\{task}\\{image}.png"),
            format!("drawing/{task}/{}.png", image.to_uppercase()),
        ] {
            assert!(reference(&value).is_err(), "{value}");
        }
        for task in [
            "../../outside",
            "00000000-0000-0000-0000-000000000000",
            &task.to_uppercase(),
        ] {
            assert!(task_directory(root.path(), task).is_err());
        }
        assert!(matches!(
            read(root.path(), &format!("drawing/{task}/{image}.png")),
            Err(Error::Unavailable)
        ));
    }

    #[test]
    fn export_strips_metadata_keeps_pixels_and_protects_private_originals() {
        let root = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let mut input = input(20, ImageFormat::Png);
        let mut bytes = STANDARD.decode(&input.data).unwrap();
        let marker = b"parameters\0SECRET-PROMPT-C:/private/file.png";
        bytes.splice(33..33, png_chunk(b"tEXt", marker));
        input.data = STANDARD.encode(&bytes);
        let files = save(root.path(), &task, &[input]).unwrap();
        let original = root.path().join(&files[0].reference);
        assert_eq!(
            export_png(root.path(), &files[0].reference, &original),
            Err(Error::InvalidReference)
        );
        let destination = output.path().join("export.png");
        export_png(root.path(), &files[0].reference, &destination).unwrap();
        let exported = std::fs::read(destination).unwrap();
        assert!(
            !exported
                .windows(marker.len())
                .any(|window| window == marker)
        );
        assert!(!exported.windows(4).any(|window| window == b"tEXt"));
        assert_eq!(
            decode_image(&exported, "image/png").unwrap().to_rgba8(),
            decode_image(&bytes, "image/png").unwrap().to_rgba8()
        );
        assert_eq!(std::fs::read(original).unwrap(), bytes);
    }

    #[test]
    fn tampered_manifest_and_missing_original_fail_recovery() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        let manifest = root
            .path()
            .join("drawing")
            .join(&task)
            .join("manifest.json");
        let mut tampered = files.clone();
        tampered[0].reference = "../outside.png".into();
        std::fs::write(
            &manifest,
            serde_json::to_vec(&Manifest {
                version: 1,
                files: tampered,
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            read_manifest(root.path(), &task).unwrap_err(),
            Error::InvalidReference
        );
        std::fs::write(
            &manifest,
            serde_json::to_vec(&Manifest {
                version: 1,
                files: files.clone(),
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::remove_file(root.path().join(&files[0].reference)).unwrap();
        assert_eq!(
            read_manifest(root.path(), &task).unwrap_err(),
            Error::Unavailable
        );
    }

    #[test]
    fn rejects_linked_directory_without_accessing_outside_files() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let linked = root.path().join("drawing");
        #[cfg(windows)]
        {
            let result = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(&linked)
                .arg(outside.path())
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "synthetic junction creation failed"
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &linked).unwrap();
        let task = Uuid::new_v4().to_string();
        assert_eq!(
            save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap_err(),
            Error::InvalidReference
        );
        assert_eq!(
            read_manifest(root.path(), &task).unwrap_err(),
            Error::InvalidReference
        );
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
        #[cfg(windows)]
        std::fs::remove_dir(&linked).unwrap();
    }
}
