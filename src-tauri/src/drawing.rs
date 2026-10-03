//! Private, bounded drawing originals with a manifest as the publication boundary.
#[path = "drawing_output.rs"]
pub mod output;
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
use tauri_plugin_opener::OpenerExt;
use uuid::{Uuid, Variant, Version};

const IMAGE_LIMIT: usize = 32 * 1024 * 1024;
const TOTAL_LIMIT: usize = 64 * 1024 * 1024;
const PIXEL_LIMIT: u64 = 32_000_000;
const IMAGE_COUNT: usize = 8;
const MANIFEST_LIMIT: usize = 16 * 1024;
pub(crate) static DRAWING_FILES: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Eq)]
enum Error {
    OutputConfig,
    OutputUnwritable,
    OutputUnavailable,
    InvalidReference,
    InvalidParameters,
    TooLarge,
    Corrupt,
    Collision,
    Unavailable,
    Storage,
}
impl Error {
    fn code(&self) -> String {
        match self {
            Self::OutputConfig => "drawing-output-config",
            Self::OutputUnwritable => "drawing-output-unwritable",
            Self::OutputUnavailable => "drawing-output-unavailable",
            Self::InvalidReference => "drawing-invalid-reference",
            Self::InvalidParameters => "drawing-invalid-parameters",
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DrawingExportParameters {
    prompt: String,
    model: String,
    protocol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    watermark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    safety_threshold: Option<DrawingSafetyThreshold>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_modalities: Option<Vec<DrawingResponseModality>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum DrawingSafetyThreshold {
    BlockNone,
    BlockOnlyHigh,
    BlockMediumAndAbove,
    BlockLowAndAbove,
    Off,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum DrawingResponseModality {
    Text,
    Image,
}

impl DrawingExportParameters {
    fn validate(&self) -> Result<(), Error> {
        if self.model.trim().is_empty()
            || [
                &self.aspect_ratio,
                &self.resolution,
                &self.size,
                &self.quality,
                &self.model_version,
                &self.output_format,
            ]
            .iter()
            .any(|value| value.as_ref().is_some_and(|value| value.trim().is_empty()))
        {
            return Err(Error::InvalidParameters);
        }
        if self
            .temperature
            .is_some_and(|value| !value.is_finite() || !(0.0..=2.0).contains(&value))
            || self.response_modalities.as_deref().is_some_and(|values| {
                !matches!(
                    values,
                    [DrawingResponseModality::Image]
                        | [
                            DrawingResponseModality::Text,
                            DrawingResponseModality::Image
                        ]
                )
            })
        {
            return Err(Error::InvalidParameters);
        }
        match self.protocol.as_str() {
            "gemini-image"
                if self.size.is_none()
                    && self.quality.is_none()
                    && self.model_version.is_none()
                    && self.output_format.is_none()
                    && self.watermark.is_none()
                    && self
                        .api_type
                        .as_deref()
                        .is_none_or(|value| value == "gemini") =>
            {
                Ok(())
            }
            "openai-images"
                if self.aspect_ratio.is_none()
                    && self.resolution.is_none()
                    && self.temperature.is_none()
                    && self.safety_threshold.is_none()
                    && self.response_modalities.is_none()
                    && self.model_version.is_none()
                    && self.output_format.is_none()
                    && self.watermark.is_none()
                    && self.api_type.as_deref().is_none_or(|value| value == "gpt") =>
            {
                Ok(())
            }
            "grok-images"
                if matches!(self.model_version.as_deref(), Some("legacy" | "2.0"))
                    && self.aspect_ratio.as_deref().is_none_or(|value| {
                        matches!(
                            value,
                            "auto"
                                | "1:1"
                                | "16:9"
                                | "9:16"
                                | "4:3"
                                | "3:4"
                                | "3:2"
                                | "2:3"
                                | "2:1"
                                | "1:2"
                                | "19.5:9"
                                | "9:19.5"
                                | "20:9"
                                | "9:20"
                        ) || (self.model_version.as_deref() == Some("2.0")
                            && matches!(value, "21:9" | "5:2"))
                    })
                    && self
                        .resolution
                        .as_deref()
                        .is_none_or(|value| matches!(value, "auto" | "1k" | "2k"))
                    && self.quality.as_deref().is_none_or(|value| {
                        self.model_version.as_deref() == Some("2.0")
                            && matches!(value, "auto" | "low" | "medium")
                    })
                    && self.size.is_none()
                    && self.output_format.is_none()
                    && self.watermark.is_none()
                    && self.api_type.is_none()
                    && self.temperature.is_none()
                    && self.safety_threshold.is_none()
                    && self.response_modalities.is_none() =>
            {
                Ok(())
            }
            "seedream-images"
                if matches!(
                    self.model_version.as_deref(),
                    Some("4.0" | "4.5" | "5.0-lite" | "5.0-pro" | "5.0-flash")
                ) && self.output_format.as_deref().is_none_or(|value| {
                    matches!(
                        self.model_version.as_deref(),
                        Some("5.0-lite" | "5.0-pro" | "5.0-flash")
                    ) && matches!(value, "auto" | "png" | "jpeg")
                }) && self.aspect_ratio.is_none()
                    && self.resolution.is_none()
                    && self.quality.is_none()
                    && self.api_type.is_none()
                    && self.temperature.is_none()
                    && self.safety_threshold.is_none()
                    && self.response_modalities.is_none() =>
            {
                Ok(())
            }
            _ => Err(Error::InvalidParameters),
        }
    }

    fn json(&self) -> Result<Vec<u8>, Error> {
        self.validate()?;
        let mut value = serde_json::to_value(self).map_err(|_| Error::InvalidParameters)?;
        let fields = value.as_object_mut().ok_or(Error::InvalidParameters)?;
        fields.retain(|key, value| {
            !matches!(
                key.as_str(),
                "aspect_ratio" | "resolution" | "size" | "quality" | "output_format"
            ) || value != "auto"
        });
        if let Some(api_type) = self.gnbp_api_type() {
            fields.insert("api_type".into(), api_type.into());
        }
        serde_json::to_vec(&value).map_err(|_| Error::InvalidParameters)
    }

    fn gnbp_api_type(&self) -> Option<&'static str> {
        match self.protocol.as_str() {
            "gemini-image" => Some("gemini"),
            "openai-images" => Some("gpt"),
            _ => None,
        }
    }
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

#[derive(Debug, Serialize)]
pub struct ImportedDrawingReference {
    #[serde(flatten)]
    file: DrawingFile,
    digest: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReferenceImportReceipt {
    version: u8,
    reference: String,
    digest: String,
    size: usize,
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

fn reference_input(value: &str) -> Result<(&str, &str), Error> {
    let name = value
        .strip_prefix("drawing/references/")
        .ok_or(Error::InvalidReference)?;
    let (id, ext) = name.rsplit_once('.').ok_or(Error::InvalidReference)?;
    uuid(id)?;
    if !matches!(ext, "png" | "jpg" | "webp" | "bmp") {
        return Err(Error::InvalidReference);
    }
    Ok((id, ext))
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
    checked_read(path, Some(limit))
}

fn checked_read(path: &Path, limit: Option<usize>) -> Result<Vec<u8>, Error> {
    let metadata = inspect(path)?.ok_or(Error::Unavailable)?;
    if !metadata.is_file() {
        return Err(Error::InvalidReference);
    }
    if limit.is_some_and(|limit| metadata.len() > limit as u64) {
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
    if limit.is_some_and(|limit| metadata.len() > limit as u64) {
        return Err(Error::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit.map_or(u64::MAX, |limit| limit as u64 + 1))
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Storage)?;
    if limit.is_some_and(|limit| bytes.len() > limit) {
        return Err(Error::TooLarge);
    }
    Ok(bytes)
}

fn decode_reference(bytes: &[u8]) -> Result<(DynamicImage, &'static str, &'static str), Error> {
    let format = image::guess_format(bytes).map_err(|_| Error::Corrupt)?;
    let (mime, ext) = match format {
        ImageFormat::Png => ("image/png", "png"),
        ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        ImageFormat::WebP => ("image/webp", "webp"),
        ImageFormat::Bmp => ("image/bmp", "bmp"),
        _ => return Err(Error::Corrupt),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.no_limits();
    let image = reader.decode().map_err(|_| Error::Corrupt)?;
    if image.width() == 0 || image.height() == 0 {
        return Err(Error::Corrupt);
    }
    Ok((image, mime, ext))
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
    if let Some(output) = output::location(root, task)? {
        if !inspect(&output)?.is_some_and(|metadata| metadata.is_dir()) { return Err(Error::OutputUnavailable); }
        let path = output.join("meta").join(task);
        if inspect(&path)?.is_some_and(|metadata| !metadata.is_dir()) { return Err(Error::InvalidReference); }
        return Ok(path);
    }
    let legacy = root.join("drawing").join(task);
    let current = root.join("drawing").join("meta").join(task);
    let old = inspect(&legacy)?;
    let new = inspect(&current)?;
    if old.as_ref().is_some_and(|metadata| !metadata.is_dir())
        || new.as_ref().is_some_and(|metadata| !metadata.is_dir())
    {
        return Err(Error::InvalidReference);
    }
    // Never guess which journal owns a task when both layouts exist.
    if old.is_some() && new.is_some() {
        return Err(Error::Collision);
    }
    Ok(if old.is_some() { legacy } else { current })
}

// References remain stable opaque IDs in IndexedDB and receipt JSON. Only this
// native boundary translates them to the layout chosen by the task's journal.
fn result_path(root: &Path, value: &str) -> Result<PathBuf, Error> {
    let (task, id, ext) = reference(value)?;
    let directory = task_directory(root, task)?;
    let path = if let Some(output) = output::location(root, task)? {
        output.join(format!("{task}_{id}.{ext}"))
    } else if directory == root.join("drawing").join(task) {
        root.join(value)
    } else {
        root.join("drawing").join(format!("{task}_{id}.{ext}"))
    };
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

fn read_manifest_descriptors(root: &Path, task: &str) -> Result<Option<Vec<DrawingFile>>, Error> {
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
    Ok(Some(manifest.files))
}

fn read_manifest(root: &Path, task: &str) -> Result<Option<Vec<DrawingFile>>, Error> {
    let Some(files) = read_manifest_descriptors(root, task)? else {
        return Ok(None);
    };
    for item in &files {
        verify_bytes(
            item,
            &bounded_read(&result_path(root, &item.reference)?, IMAGE_LIMIT)?,
        )?;
    }
    Ok(Some(files))
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
    let path = result_path(root, &item.file.reference)?;
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

#[derive(Debug, Serialize)]
pub struct RecoveryInventory {
    total: usize,
    durable: Vec<usize>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryImage {
    index: usize,
    image: DrawingImageInput,
}

// Refill only missing receipt entries, allowing the frontend to release every
// durable image rather than retaining a whole multi-image response after a fault.
fn resume_recovery(
    root: &Path,
    task: &str,
    images: &[RecoveryImage],
) -> Result<Vec<DrawingFile>, Error> {
    if let Some(files) = recover(root, task)? {
        return Ok(files);
    }
    let pending = read_pending(root, task)?.ok_or(Error::Unavailable)?;
    if images.len() > pending.files.len() {
        return Err(Error::Collision);
    }
    let mut indices = HashSet::new();
    let mut writes = Vec::new();
    for input in images {
        if !indices.insert(input.index) {
            return Err(Error::Collision);
        }
        let item = pending.files.get(input.index).ok_or(Error::Collision)?;
        let bytes = decode_inputs(std::slice::from_ref(&input.image))?.remove(0);
        if input.image.mime != item.file.mime
            || bytes.len() != item.file.size
            || sha256(&bytes) != item.sha256
        {
            return Err(Error::Collision);
        }
        verify_bytes(&item.file, &bytes)?;
        if !verify_pending_file(root, item)? {
            writes.push((&item.file, bytes));
        }
    }
    // No writes until the entire supplied subset and existing receipt validate.
    for item in &pending.files {
        verify_pending_file(root, item)?;
    }
    for (file, bytes) in writes {
        publish(&result_path(root, &file.reference)?, &bytes)?;
    }
    recover(root, task)?.ok_or(Error::Unavailable)
}

fn recovery_inventory(root: &Path, task: &str) -> Result<RecoveryInventory, Error> {
    if let Some(files) = read_manifest(root, task)? {
        return Ok(RecoveryInventory {
            total: files.len(),
            durable: (0..files.len()).collect(),
        });
    }
    let Some(pending) = read_pending(root, task)? else {
        return Ok(RecoveryInventory {
            total: 0,
            durable: Vec::new(),
        });
    };
    let mut durable = Vec::new();
    for (index, item) in pending.files.iter().enumerate() {
        if verify_pending_file(root, item)? {
            durable.push(index);
        }
    }
    Ok(RecoveryInventory {
        total: pending.files.len(),
        durable,
    })
}

// Called only after terminal history deletion commits and there are no independent
// result owners. Never scan or recursively remove a directory or follow links.
fn discard_recovery(root: &Path, task: &str) -> Result<(), Error> {
    discard_recovery_with_mode(root, task, false)
}

fn discard_completed(root: &Path, task: &str) -> Result<(), Error> {
    discard_recovery_with_mode(root, task, true)
}

fn validate_completed_receipt(root: &Path, task: &str, files: &[DrawingFile]) -> Result<(), Error> {
    if let Some(pending) = read_pending(root, task)? {
        if pending.files.len() != files.len() {
            return Err(Error::Collision);
        }
        for (planned, published) in pending.files.iter().zip(files) {
            if planned.file != *published || !verify_pending_file(root, planned)? {
                return Err(Error::Collision);
            }
        }
    }
    Ok(())
}

fn discard_recovery_with_mode(root: &Path, task: &str, completed_only: bool) -> Result<(), Error> {
    let directory = task_directory(root, task)?;
    let files = if let Some(files) = read_manifest(root, task)? {
        validate_completed_receipt(root, task, &files)?;
        files
    } else if completed_only {
        return Err(Error::Unavailable);
    } else if let Some(pending) = read_pending(root, task)? {
        pending.files.into_iter().map(|item| item.file).collect()
    } else {
        Vec::new()
    };
    let mut paths = files
        .iter()
        .map(|file| result_path(root, &file.reference))
        .collect::<Result<Vec<_>, _>>()?;
    paths.push(directory.join("manifest.json"));
    paths.push(directory.join("pending.json"));
    // Validate all paths before removing any bytes; damaged metadata fails closed.
    for path in &paths {
        if inspect(path)?.is_some_and(|metadata| !metadata.is_file()) {
            return Err(Error::InvalidReference);
        }
    }
    for path in paths {
        if inspect(&path)?.is_some() {
            std::fs::remove_file(path).map_err(|_| Error::Storage)?;
        }
    }
    if inspect(&directory)?.is_some() {
        std::fs::remove_dir(directory).map_err(|_| Error::Storage)?;
    }
    Ok(())
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
                || bounded_read(&result_path(root, &item.reference)?, IMAGE_LIMIT)? != *bytes
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
            publish(&result_path(root, &item.file.reference)?, bytes)?;
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

fn import_reference(
    root: &Path,
    input: &DrawingImageInput,
) -> Result<ImportedDrawingReference, Error> {
    let bytes = STANDARD.decode(&input.data).map_err(|_| Error::Corrupt)?;
    import_reference_bytes(root, &bytes)
}

fn import_reference_bytes(
    root: &Path,
    bytes: &[u8],
) -> Result<ImportedDrawingReference, Error> {
    import_reference_with_publisher(root, bytes, None, publish)
}

fn import_reference_scoped(
    root: &Path,
    bytes: &[u8],
    scope: &str,
) -> Result<ImportedDrawingReference, Error> {
    import_reference_with_publisher(root, bytes, Some(scope), publish)
}

fn import_reference_with_publisher(
    root: &Path,
    bytes: &[u8],
    scope: Option<&str>,
    publish: impl FnOnce(&Path, &[u8]) -> Result<(), Error>,
) -> Result<ImportedDrawingReference, Error> {
    // Browser MIME labels are advisory; preserve the detected original format.
    let (image, mime, ext) = decode_reference(bytes)?;
    let id = Uuid::new_v4().to_string();
    let value = format!("drawing/references/{id}.{ext}");
    let digest = sha256(bytes);
    let path = root.join(&value);
    inspect(&path)?;
    let directory = path.parent().ok_or(Error::Storage)?;
    std::fs::create_dir_all(directory).map_err(|_| Error::Storage)?;
    inspect(directory)?;
    let receipt_path = if let Some(scope) = scope {
        let directory = reference_import_directory(root, scope)?;
        std::fs::create_dir_all(&directory).map_err(|_| Error::Storage)?;
        inspect(&directory)?;
        let receipt_path = directory.join(format!("{id}.json"));
        if inspect(&receipt_path)?.is_some() {
            return Err(Error::Collision);
        }
        let receipt = ReferenceImportReceipt {
            version: 1, reference: value.clone(), digest: digest.clone(), size: bytes.len(),
        };
        let encoded = serde_json::to_vec(&receipt).map_err(|_| Error::Storage)?;
        if let Err(error) = self::publish(&receipt_path, &encoded) {
            if error != Error::Collision && inspect(&receipt_path)?.is_some() {
                std::fs::remove_file(&receipt_path).map_err(|_| Error::Storage)?;
            }
            return Err(error);
        }
        Some(receipt_path)
    } else { None };
    if let Err(error) = publish(&path, bytes) {
        // Publication can fail after persisting (for example on final sync).
        // The failed import must not leave its newly reserved original behind.
        if error != Error::Collision && inspect(&path)?.is_some() {
            std::fs::remove_file(&path).map_err(|_| Error::Storage)?;
        }
        if let Some(receipt_path) = receipt_path {
            inspect(&receipt_path)?;
            std::fs::remove_file(receipt_path).map_err(|_| Error::Storage)?;
        }
        return Err(error);
    }
    Ok(ImportedDrawingReference {
        file: DrawingFile {
            id,
            reference: value,
            mime: mime.to_owned(),
            size: bytes.len(),
            width: image.width(),
            height: image.height(),
        },
        digest,
    })
}

fn raw_reference_body(body: &tauri::ipc::InvokeBody) -> Result<&[u8], Error> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        tauri::ipc::InvokeBody::Json(_) => Err(Error::InvalidParameters),
    }
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn reference_import_scope(url: &tauri::Url) -> Result<String, Error> {
    let origin = url.origin().ascii_serialization();
    if origin == "null" || !matches!(url.scheme(), "http" | "https") {
        return Err(Error::InvalidReference);
    }
    Ok(sha256(format!("{origin}\0AyaseStudio").as_bytes()))
}

fn reference_import_directory(root: &Path, scope: &str) -> Result<PathBuf, Error> {
    if !valid_digest(scope) { return Err(Error::InvalidReference); }
    let directory = root.join("drawing").join("meta").join("reference-imports").join(scope);
    if inspect(&directory)?.is_some_and(|metadata| !metadata.is_dir()) {
        return Err(Error::InvalidReference);
    }
    Ok(directory)
}

fn reference_import_directories(root: &Path, scope: &str) -> Result<[PathBuf; 2], Error> {
    let current = reference_import_directory(root, scope)?;
    let legacy = root.join("drawing").join("reference-imports").join(scope);
    if inspect(&legacy)?.is_some_and(|metadata| !metadata.is_dir()) {
        return Err(Error::InvalidReference);
    }
    Ok([current, legacy])
}

fn read_reference_receipt(path: &Path) -> Result<ReferenceImportReceipt, Error> {
    let name = path.file_name().and_then(|name| name.to_str()).ok_or(Error::InvalidReference)?;
    let id = name.strip_suffix(".json").ok_or(Error::InvalidReference)?;
    uuid(id)?;
    let receipt: ReferenceImportReceipt = serde_json::from_slice(&bounded_read(path, MANIFEST_LIMIT)?)
        .map_err(|_| Error::Corrupt)?;
    let (reference_id, _) = reference_input(&receipt.reference)?;
    if receipt.version != 1 || reference_id != id || !valid_digest(&receipt.digest) || receipt.size == 0 {
        return Err(Error::Corrupt);
    }
    Ok(receipt)
}

fn list_references(root: &Path, scope: &str) -> Result<Vec<String>, Error> {
    let mut references = Vec::new();
    for directory in reference_import_directories(root, scope)? {
        if inspect(&directory)?.is_none() { continue; }
        for entry in std::fs::read_dir(&directory).map_err(|_| Error::Storage)? {
            let entry = entry.map_err(|_| Error::Storage)?;
            let name = entry.file_name();
            let name = name.to_str().ok_or(Error::InvalidReference)?;
            let receipt = read_reference_receipt(&directory.join(name))?;
            if inspect(&root.join(&receipt.reference))?.is_some_and(|metadata| !metadata.is_file()) {
                return Err(Error::InvalidReference);
            }
            references.push(receipt.reference);
        }
    }
    references.sort();
    if references.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(Error::Collision);
    }
    Ok(references)
}

fn remove_scoped_references(root: &Path, scope: &str, values: &[String]) -> Result<(), Error> {
    let directories = reference_import_directories(root, scope)?;
    let receipts = values.iter().map(|value| {
        let (id, _) = reference_input(value)?;
        let mut found = None;
        for directory in &directories {
            let path = directory.join(format!("{id}.json"));
            if inspect(&path)?.is_some() {
                if found.is_some() { return Err(Error::Collision); }
                found = Some(path);
            }
        }
        let Some(path) = found else { return Ok(None); };
        let receipt = read_reference_receipt(&path)?;
        if receipt.reference != *value { return Err(Error::Corrupt); }
        if let Some(metadata) = inspect(&root.join(value))? {
            if !metadata.is_file() || metadata.len() != receipt.size as u64 {
                return Err(Error::Corrupt);
            }
            let bytes = checked_read(&root.join(value), None)?;
            if bytes.len() != receipt.size || sha256(&bytes) != receipt.digest {
                return Err(Error::Corrupt);
            }
        }
        Ok(Some(path))
    }).collect::<Result<Vec<_>, Error>>()?;
    // Validate every requested receipt before deleting any original or receipt.
    remove_references(root, values)?;
    for path in receipts.into_iter().flatten() {
        match std::fs::remove_file(path) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err(Error::Storage),
        }
    }
    Ok(())
}

fn remove_references(root: &Path, values: &[String]) -> Result<(), Error> {
    // Validate the entire explicit list before deleting any file.
    let paths = values
        .iter()
        .map(|value| {
            reference_input(value)?;
            let path = root.join(value);
            if inspect(&path)?.is_some_and(|metadata| !metadata.is_file()) {
                return Err(Error::InvalidReference);
            }
            Ok(path)
        })
        .collect::<Result<Vec<_>, _>>()?;
    for path in paths {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Error::Storage),
        }
    }
    Ok(())
}

fn read(root: &Path, value: &str) -> Result<DrawingImageInput, Error> {
    if value.starts_with("drawing/references/") {
        let (_, ext) = reference_input(value)?;
        let bytes = checked_read(&root.join(value), None)?;
        let (_, mime, detected_ext) = decode_reference(&bytes)?;
        if ext != detected_ext {
            return Err(Error::Corrupt);
        }
        return Ok(DrawingImageInput {
            mime: mime.to_owned(),
            data: STANDARD.encode(bytes),
        });
    }
    let (mime, bytes) = read_result_bytes(root, value)?;
    Ok(DrawingImageInput {
        mime,
        data: STANDARD.encode(bytes),
    })
}

fn read_result_bytes(root: &Path, value: &str) -> Result<(String, Vec<u8>), Error> {
    let (task, _, _) = reference(value)?;
    // A missing sibling must not hide an otherwise valid, published result.
    // Recovery still checks every original through read_manifest.
    let files = read_manifest_descriptors(root, task)?.ok_or(Error::Unavailable)?;
    let item = files
        .iter()
        .find(|item| item.reference == value)
        .ok_or(Error::Unavailable)?;
    let bytes = bounded_read(&result_path(root, value)?, IMAGE_LIMIT)?;
    verify_bytes(item, &bytes)?;
    Ok((item.mime.clone(), bytes))
}

fn thumbnail(root: &Path, value: &str) -> Result<DrawingImageInput, Error> {
    let image = if value.starts_with("drawing/references/") {
        let (_, ext) = reference_input(value)?;
        let bytes = checked_read(&root.join(value), None)?;
        let (image, _, detected_ext) = decode_reference(&bytes)?;
        if ext != detected_ext {
            return Err(Error::Corrupt);
        }
        image
    } else {
        let (mime, bytes) = read_result_bytes(root, value)?;
        decode_image(&bytes, &mime)?
    };
    let image = if image.width() > 256 || image.height() > 256 {
        image.thumbnail(256, 256)
    } else {
        image
    };
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| Error::Storage)?;
    Ok(DrawingImageInput {
        mime: "image/png".to_owned(),
        data: STANDARD.encode(png.into_inner()),
    })
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

fn png_chunk(name: &[u8; 4], data: &[u8]) -> Result<Vec<u8>, Error> {
    let length = u32::try_from(data.len()).map_err(|_| Error::TooLarge)?;
    let mut chunk = length.to_be_bytes().to_vec();
    chunk.extend_from_slice(name);
    chunk.extend_from_slice(data);
    let checksum = crc32(&chunk[4..]);
    chunk.extend_from_slice(&checksum.to_be_bytes());
    Ok(chunk)
}

fn export_png(root: &Path, value: &str, destination: &Path) -> Result<(), Error> {
    export_png_with_parameters(root, value, destination, None)
}

fn export_png_with_parameters(
    root: &Path,
    value: &str,
    destination: &Path,
    parameters: Option<&DrawingExportParameters>,
) -> Result<(), Error> {
    let parameter_keyword = parameters.map(|parameters| {
        if parameters.gnbp_api_type().is_some() {
            "parameters"
        } else {
            "ayase_parameters"
        }
    });
    let parameters = parameters.map(DrawingExportParameters::json).transpose()?;
    let input = read(root, value)?;
    let bytes = STANDARD.decode(input.data).map_err(|_| Error::Corrupt)?;
    let image = decode_image(&bytes, &input.mime)?;
    // Encoding fresh pixels never copies EXIF, text, XMP or generation metadata.
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| Error::Storage)?;
    let mut png = png.into_inner();
    if let Some(parameters) = parameters {
        // Only mapped protocols use GNBP's parameters namespace.
        // Uncompressed iTXt preserves Unicode in both namespaces.
        // Insert after the freshly encoded PNG's fixed IHDR chunk.
        let mut text = parameter_keyword.unwrap().as_bytes().to_vec();
        text.extend_from_slice(b"\0\0\0\0\0");
        text.extend_from_slice(&parameters);
        png.splice(33..33, png_chunk(b"iTXt", &text)?);
    }
    if inspect(destination)?.is_some_and(|metadata| !metadata.is_file()) {
        return Err(Error::InvalidReference);
    }
    let parent = destination.parent().ok_or(Error::InvalidReference)?;
    if !inspect(parent)?.is_some_and(|metadata| metadata.is_dir()) {
        return Err(Error::InvalidReference);
    }
    output::protect_export(root, destination)?;
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
    output.write_all(&png).map_err(|_| Error::Storage)?;
    output.flush().map_err(|_| Error::Storage)?;
    output.as_file().sync_all().map_err(|_| Error::Storage)?;
    output.persist(destination).map_err(|_| Error::Storage)?;
    Ok(())
}

fn app_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| Error::Storage.code())
}

// Reuse the actual originals directory, including existing task subdirectories.
// Do not scan, duplicate images, change references or accept a frontend path.
#[cfg(test)]
fn output_directory(root: &Path) -> Result<PathBuf, Error> {
    let directory = root.join("drawing");
    if inspect(&directory)?.is_some_and(|metadata| !metadata.is_dir()) {
        return Err(Error::InvalidReference);
    }
    std::fs::create_dir_all(&directory).map_err(|_| Error::Storage)?;
    if !inspect(&directory)?.is_some_and(|metadata| metadata.is_dir()) {
        return Err(Error::InvalidReference);
    }
    let root = root.canonicalize().map_err(|_| Error::Storage)?;
    let resolved = directory.canonicalize().map_err(|_| Error::Storage)?;
    if resolved != root.join("drawing") {
        return Err(Error::InvalidReference);
    }
    Ok(directory)
}

#[tauri::command]
pub async fn open_drawing_output_directory(app: AppHandle) -> Result<(), String> {
    let root = app_directory(&app)?;
    let default = output::default_directory(&app, &root).map_err(|error| error.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = {
            let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
            output::configured_directory(&root, &default).map_err(|error| error.code())?
        };
        let path = directory.to_str().ok_or_else(|| Error::Storage.code())?;
        app.opener().open_path(path, None::<&str>).map_err(|_| "drawing-open-directory".to_owned())
    }).await.map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn import_drawing_reference(
    app: AppHandle,
    image: DrawingImageInput,
) -> Result<ImportedDrawingReference, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        import_reference(&root, &image).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn import_drawing_reference_bytes(
    app: AppHandle,
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportedDrawingReference, String> {
    let bytes = raw_reference_body(request.body())
        .map_err(|error| error.code())?
        .to_vec();
    let root = app_directory(&app)?;
    let scope = reference_import_scope(&webview.url().map_err(|_| Error::InvalidReference.code())?)
        .map_err(|error| error.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        import_reference_scoped(&root, &bytes, &scope).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn list_drawing_references(app: AppHandle, webview: tauri::Webview) -> Result<Vec<String>, String> {
    let root = app_directory(&app)?;
    let scope = reference_import_scope(&webview.url().map_err(|_| Error::InvalidReference.code())?)
        .map_err(|error| error.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        list_references(&root, &scope).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn remove_drawing_references(
    app: AppHandle,
    webview: tauri::Webview,
    references: Vec<String>,
) -> Result<(), String> {
    let root = app_directory(&app)?;
    let scope = reference_import_scope(&webview.url().map_err(|_| Error::InvalidReference.code())?)
        .map_err(|error| error.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        remove_scoped_references(&root, &scope, &references).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn save_drawing_result(
    app: AppHandle,
    task_id: String,
    images: Vec<DrawingImageInput>,
) -> Result<Vec<DrawingFile>, String> {
    let root = app_directory(&app)?;
    let default = output::default_directory(&app, &root).map_err(|error| error.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        output::reserve(&root, &default, std::slice::from_ref(&task_id)).map_err(|error| error.code())?;
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
pub async fn inspect_drawing_recovery(
    app: AppHandle,
    task_id: String,
) -> Result<RecoveryInventory, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        recovery_inventory(&root, &task_id).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn discard_drawing_recovery(
    app: AppHandle,
    task_id: String,
    completed_only: Option<bool>,
) -> Result<(), String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        if completed_only.unwrap_or(false) {
            discard_completed(&root, &task_id)
        } else {
            discard_recovery(&root, &task_id)
        }
        .map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn resume_drawing_recovery(
    app: AppHandle,
    task_id: String,
    images: Vec<RecoveryImage>,
) -> Result<Vec<DrawingFile>, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        resume_recovery(&root, &task_id, &images).map_err(|error| error.code())
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
pub async fn read_drawing_thumbnail(
    app: AppHandle,
    reference: String,
) -> Result<DrawingImageInput, String> {
    let root = app_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        thumbnail(&root, &reference).map_err(|error| error.code())
    })
    .await
    .map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn export_drawing_result(
    app: AppHandle,
    reference: String,
    parameters: Option<DrawingExportParameters>,
) -> Result<bool, String> {
    let root = app_directory(&app)?;
    self::reference(&reference).map_err(|error| error.code())?;
    if let Some(parameters) = &parameters {
        parameters.validate().map_err(|error| error.code())?;
    }
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
        let result = if let Some(parameters) = &parameters {
            export_png_with_parameters(&root, &reference, &destination, Some(parameters))
        } else {
            export_png(&root, &reference, &destination)
        };
        result.map(|_| true).map_err(|error| error.code())
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
            ImageFormat::Bmp => "image/bmp",
            _ => unreachable!(),
        };
        DrawingImageInput {
            mime: mime.to_owned(),
            data: STANDARD.encode(bytes.into_inner()),
        }
    }

    fn png_chunk(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
        super::png_chunk(name, data).unwrap()
    }

    #[test]
    fn raw_and_base64_imports_preserve_original_formats_alpha_and_descriptors() {
        let root = tempfile::tempdir().unwrap();
        let scope = sha256(b"scope-a");
        let rgba = image::RgbaImage::from_pixel(3, 2, image::Rgba([20, 40, 90, 70]));
        for (format, mime, ext) in [
            (ImageFormat::Png, "image/png", "png"),
            (ImageFormat::Jpeg, "image/jpeg", "jpg"),
            (ImageFormat::WebP, "image/webp", "webp"),
            (ImageFormat::Bmp, "image/bmp", "bmp"),
        ] {
            let image = if format == ImageFormat::Jpeg {
                DynamicImage::ImageRgba8(rgba.clone()).to_rgb8().into()
            } else {
                DynamicImage::ImageRgba8(rgba.clone())
            };
            let mut encoded = Cursor::new(Vec::new());
            image.write_to(&mut encoded, format).unwrap();
            let mut bytes = encoded.into_inner();
            if format == ImageFormat::Png {
                bytes.splice(33..33, png_chunk(b"tEXt", b"original\0keep-metadata"));
            }
            let input = DrawingImageInput {
                mime: "application/octet-stream".into(),
                data: STANDARD.encode(&bytes),
            };
            let imported = import_reference(root.path(), &input).unwrap();
            let body = tauri::ipc::InvokeBody::Raw(bytes.clone());
            let duplicate = import_reference_scoped(
                root.path(),
                raw_reference_body(&body).unwrap(),
                &scope,
            )
            .unwrap();
            assert_eq!(imported.digest, sha256(&bytes));
            assert_eq!(imported.digest, duplicate.digest);
            assert_ne!(imported.file.reference, duplicate.file.reference);
            assert_eq!(imported.file.mime, duplicate.file.mime);
            assert_eq!(imported.file.size, duplicate.file.size);
            assert_eq!(imported.file.width, duplicate.file.width);
            assert_eq!(imported.file.height, duplicate.file.height);
            assert_eq!(imported.file.mime, mime);
            assert_eq!(imported.file.size, bytes.len());
            assert_eq!((imported.file.width, imported.file.height), (3, 2));
            assert_eq!(
                reference_input(&imported.file.reference).unwrap(),
                (imported.file.id.as_str(), ext)
            );
            assert_eq!(
                std::fs::read(root.path().join(&imported.file.reference)).unwrap(),
                bytes
            );
            for reference in [&imported.file.reference, &duplicate.file.reference] {
                assert_eq!(
                    std::fs::read(root.path().join(reference)).unwrap(),
                    bytes
                );
                let read = read(root.path(), reference).unwrap();
                assert_eq!(read.data, input.data);
                assert_eq!(read.mime, mime);
                if format != ImageFormat::Jpeg {
                    assert_eq!(
                        decode_reference(&STANDARD.decode(read.data).unwrap())
                            .unwrap()
                            .0
                            .to_rgba8(),
                        rgba
                    );
                }
            }
            let descriptor = serde_json::to_value(imported).unwrap();
            assert_eq!(descriptor["digest"], sha256(&bytes));
            assert_eq!(descriptor["mime"], mime);
            assert!(descriptor.get("file").is_none());
        }
    }

    #[test]
    fn raw_reference_body_rejects_json_payloads() {
        let bytes = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        let body = tauri::ipc::InvokeBody::Raw(bytes.clone());
        assert_eq!(raw_reference_body(&body).unwrap(), bytes);
        for value in [
            serde_json::json!({ "image": { "mime": "image/png", "data": STANDARD.encode(&bytes) } }),
            serde_json::json!(bytes),
            serde_json::Value::Null,
        ] {
            assert_eq!(
                raw_reference_body(&tauri::ipc::InvokeBody::Json(value)).unwrap_err(),
                Error::InvalidParameters
            );
        }
    }

    #[test]
    fn references_do_not_inherit_output_byte_budget() {
        let root = tempfile::tempdir().unwrap();
        let mut bytes = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        bytes.resize(IMAGE_LIMIT + 1, 0);
        let input = DrawingImageInput {
            mime: "image/png".into(),
            data: STANDARD.encode(&bytes),
        };
        let imported = import_reference(root.path(), &input).unwrap();
        let raw = import_reference_bytes(root.path(), &bytes).unwrap();
        assert_eq!(imported.file.size, IMAGE_LIMIT + 1);
        assert_eq!(raw.file.size, imported.file.size);
        assert_eq!(raw.digest, imported.digest);
        assert_eq!(std::fs::read(root.path().join(&raw.file.reference)).unwrap(), bytes);
        assert_eq!(
            read(root.path(), &imported.file.reference).unwrap().data,
            input.data
        );
        assert!(matches!(decode_inputs(&[input]), Err(Error::TooLarge)));
    }

    #[test]
    fn corrupt_reference_imports_and_failed_publication_leave_no_original() {
        let root = tempfile::tempdir().unwrap();
        let png = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        for input in [
            DrawingImageInput {
                mime: "image/png".into(),
                data: "bad base64!".into(),
            },
            DrawingImageInput {
                mime: "image/png".into(),
                data: STANDARD.encode("not an image"),
            },
            DrawingImageInput {
                mime: "image/png".into(),
                data: STANDARD.encode(&png[..40]),
            },
        ] {
            assert_eq!(
                import_reference(root.path(), &input).unwrap_err(),
                Error::Corrupt
            );
        }
        for bytes in [b"not an image".as_slice(), &png[..40], &[]] {
            assert_eq!(
                import_reference_bytes(root.path(), bytes).unwrap_err(),
                Error::Corrupt
            );
        }
        assert!(!root.path().join("drawing").exists());
        assert_eq!(
            import_reference_with_publisher(
                root.path(),
                &png,
                None,
                |path, _| {
                    std::fs::write(path, b"partial").unwrap();
                    Err(Error::Storage)
                }
            )
            .unwrap_err(),
            Error::Storage
        );
        assert_eq!(
            std::fs::read_dir(root.path().join("drawing/references"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn reference_scope_uses_native_url_origin_and_rejects_opaque_origins() {
        let scope = |url| reference_import_scope(&tauri::Url::parse(url).unwrap());
        assert_eq!(scope("http://127.0.0.1:1496/a?input=b").unwrap(), scope("http://127.0.0.1:1496/c").unwrap());
        assert_ne!(scope("http://127.0.0.1:1496/").unwrap(), scope("http://tauri.localhost/").unwrap());
        assert_ne!(scope("http://127.0.0.1:1496/").unwrap(), scope("http://127.0.0.1:1420/").unwrap());
        for url in ["file:///C:/app/index.html", "data:text/plain,unknown", "tauri://localhost/", "about:blank"] {
            assert_eq!(scope(url).unwrap_err(), Error::InvalidReference);
        }
    }

    #[test]
    fn reference_receipts_isolate_scopes_and_exclude_legacy_originals() {
        let root = tempfile::tempdir().unwrap();
        let a = sha256(b"scope-a");
        let b = sha256(b"scope-b");
        let png = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        let imported_a = import_reference_scoped(root.path(), &png, &a).unwrap();
        assert!(list_references(root.path(), &b).unwrap().is_empty());
        let imported_b = import_reference_scoped(root.path(), &png, &b).unwrap();
        let legacy = import_reference(root.path(), &input(30, ImageFormat::Bmp)).unwrap();
        assert_eq!(list_references(root.path(), &a).unwrap(), vec![imported_a.file.reference.clone()]);
        assert_eq!(list_references(root.path(), &b).unwrap(), vec![imported_b.file.reference.clone()]);
        remove_scoped_references(root.path(), &b, &[imported_b.file.reference]).unwrap();
        assert_eq!(list_references(root.path(), &a).unwrap(), vec![imported_a.file.reference.clone()]);
        assert!(root.path().join(&imported_a.file.reference).exists());
        assert!(root.path().join(&legacy.file.reference).exists());
        assert!(list_references(root.path(), &b).unwrap().is_empty());
        remove_scoped_references(root.path(), &a, &[legacy.file.reference]).unwrap();
        assert!(root.path().join(&imported_a.file.reference).exists());
    }

    #[test]
    fn reference_receipt_precedes_publication_and_failed_import_cleans_both() {
        let root = tempfile::tempdir().unwrap();
        let scope = sha256(b"scope-a");
        let png = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        assert_eq!(import_reference_with_publisher(root.path(), &png, Some(&scope), |path, _| {
            assert!(!path.exists());
            let references = list_references(root.path(), &scope).unwrap();
            assert_eq!(references.len(), 1);
            assert_eq!(root.path().join(&references[0]), path);
            std::fs::write(path, b"partial").unwrap();
            Err(Error::Storage)
        }).unwrap_err(), Error::Storage);
        assert!(list_references(root.path(), &scope).unwrap().is_empty());
        assert_eq!(std::fs::read_dir(root.path().join("drawing/references")).unwrap().count(), 0);
        let imported = import_reference_scoped(root.path(), &png, &scope).unwrap();
        std::fs::remove_file(root.path().join(&imported.file.reference)).unwrap();
        assert_eq!(list_references(root.path(), &scope).unwrap(), vec![imported.file.reference.clone()]);
        remove_scoped_references(root.path(), &scope, &[imported.file.reference]).unwrap();
        assert!(list_references(root.path(), &scope).unwrap().is_empty());
    }

    #[test]
    fn invalid_reference_receipts_prevent_all_requested_deletes() {
        let scope = sha256(b"scope-a");
        let png = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        for invalid in ["version", "digest", "size", "reference", "unknown", "malformed"] {
            let root = tempfile::tempdir().unwrap();
            let first = import_reference_scoped(root.path(), &png, &scope).unwrap();
            let second = import_reference_scoped(root.path(), &png, &scope).unwrap();
            let receipt_path = reference_import_directory(root.path(), &scope).unwrap().join(format!("{}.json", second.file.id));
            let mut receipt = serde_json::to_value(read_reference_receipt(&receipt_path).unwrap()).unwrap();
            match invalid {
                "version" => receipt["version"] = serde_json::json!(2),
                "digest" => receipt["digest"] = serde_json::json!("bad-digest"),
                "size" => receipt["size"] = serde_json::json!(0),
                "reference" => receipt["reference"] = serde_json::json!(first.file.reference),
                "unknown" => receipt["unknown"] = serde_json::json!(true),
                "malformed" => {},
                _ => unreachable!(),
            }
            let corrupted = if invalid == "malformed" { b"{invalid".to_vec() } else { serde_json::to_vec(&receipt).unwrap() };
            std::fs::write(&receipt_path, &corrupted).unwrap();
            assert!(list_references(root.path(), &scope).is_err());
            assert!(remove_scoped_references(root.path(), &scope, &[first.file.reference.clone(), second.file.reference.clone()]).is_err());
            assert_eq!(std::fs::read(root.path().join(&first.file.reference)).unwrap(), png);
            assert_eq!(std::fs::read(root.path().join(&second.file.reference)).unwrap(), png);
            assert_eq!(std::fs::read(receipt_path).unwrap(), corrupted);
        }
    }

    #[test]
    fn original_digest_or_size_mismatch_preserves_all_receipted_files() {
        let scope = sha256(b"scope-a");
        let png = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        for truncate in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let first = import_reference_scoped(root.path(), &png, &scope).unwrap();
            let second = import_reference_scoped(root.path(), &png, &scope).unwrap();
            let mut modified = png.clone();
            if truncate { modified.pop(); } else { modified[40] ^= 1; }
            std::fs::write(root.path().join(&second.file.reference), &modified).unwrap();
            // Inventory does not read retained original content.
            assert_eq!(list_references(root.path(), &scope).unwrap().len(), 2);
            assert_eq!(remove_scoped_references(root.path(), &scope, &[first.file.reference.clone(), second.file.reference.clone()]).unwrap_err(), Error::Corrupt);
            assert_eq!(std::fs::read(root.path().join(&first.file.reference)).unwrap(), png);
            assert_eq!(std::fs::read(root.path().join(&second.file.reference)).unwrap(), modified);
            assert_eq!(list_references(root.path(), &scope).unwrap().len(), 2);
        }
    }

    #[test]
    fn reference_inventory_lists_only_fixed_directory_without_writes() {
        let root = tempfile::tempdir().unwrap();
        let scope = sha256(b"scope-a");
        assert!(list_references(root.path(), &scope).unwrap().is_empty());
        assert!(!root.path().join("drawing").exists());
        let mut expected = Vec::new();
        for format in [ImageFormat::Png, ImageFormat::Jpeg, ImageFormat::WebP, ImageFormat::Bmp] {
            let bytes = STANDARD.decode(input(20, format).data).unwrap();
            let imported = import_reference_scoped(root.path(), &bytes, &scope).unwrap();
            expected.push(imported.file.reference);
        }
        let task = Uuid::new_v4().to_string();
        let outputs = save(root.path(), &task, &[input(30, ImageFormat::Png)]).unwrap();
        expected.sort();
        assert_eq!(list_references(root.path(), &scope).unwrap(), expected);
        assert!(result_path(root.path(), &outputs[0].reference).unwrap().exists());
        for reference in expected {
            assert!(root.path().join(reference).exists());
        }
    }

    #[test]
    fn reference_inventory_refuses_invalid_entries_and_nonfiles() {
        let scope = sha256(b"scope-a");
        for name in [
            "unknown.txt".to_owned(),
            format!("{}.JSON", Uuid::new_v4()),
            "00000000-0000-4000-8000-00000000000A.json".to_owned(),
        ] {
            let root = tempfile::tempdir().unwrap();
            let imported = import_reference(root.path(), &input(20, ImageFormat::Png)).unwrap();
            let directory = reference_import_directory(root.path(), &scope).unwrap();
            std::fs::create_dir_all(&directory).unwrap();
            let invalid = directory.join(name);
            std::fs::write(&invalid, b"keep unknown original").unwrap();
            assert_eq!(list_references(root.path(), &scope).unwrap_err(), Error::InvalidReference);
            assert!(invalid.exists());
            assert!(root.path().join(imported.file.reference).exists());
        }
        let root = tempfile::tempdir().unwrap();
        let directory = reference_import_directory(root.path(), &scope).unwrap();
        std::fs::create_dir_all(directory.parent().unwrap()).unwrap();
        std::fs::write(&directory, b"keep").unwrap();
        assert_eq!(list_references(root.path(), &scope).unwrap_err(), Error::InvalidReference);
        std::fs::remove_file(&directory).unwrap();
        std::fs::create_dir_all(directory.join(format!("{}.json", Uuid::new_v4()))).unwrap();
        assert_eq!(list_references(root.path(), &scope).unwrap_err(), Error::InvalidReference);
    }

    #[test]
    fn reference_inventory_refuses_linked_directory_and_entry() {
        let scope = sha256(b"scope-a");
        for linked_entry in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("private.png"), b"keep outside").unwrap();
            let linked = if linked_entry {
                let bytes = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
                let imported = import_reference_scoped(root.path(), &bytes, &scope).unwrap();
                assert!(root.path().join(imported.file.reference).exists());
                reference_import_directory(root.path(), &scope).unwrap().join(format!("{}.json", Uuid::new_v4()))
            } else {
                let directory = reference_import_directory(root.path(), &scope).unwrap();
                std::fs::create_dir_all(directory.parent().unwrap()).unwrap();
                directory
            };
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
                    "synthetic junction creation failed: {} {}",
                    String::from_utf8_lossy(&result.stdout),
                    String::from_utf8_lossy(&result.stderr)
                );
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(outside.path(), &linked).unwrap();
            assert_eq!(list_references(root.path(), &scope).unwrap_err(), Error::InvalidReference);
            assert_eq!(std::fs::read(outside.path().join("private.png")).unwrap(), b"keep outside");
        }
    }

    #[test]
    fn removal_accepts_only_explicit_managed_references_and_preserves_results() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        let imported = import_reference(root.path(), &input(30, ImageFormat::Bmp)).unwrap();
        let original = root.path().join(&imported.file.reference);
        for invalid in [
            files[0].reference.clone(),
            original.to_string_lossy().into_owned(),
            "drawing/references".into(),
            format!("drawing/references/../{}.png", imported.file.id),
            format!("drawing/references/{}.BMP", imported.file.id),
            format!("drawing\\references\\{}.bmp", imported.file.id),
            format!("drawing/references/{}.bmp", imported.file.id.to_uppercase()),
        ] {
            assert_eq!(
                remove_references(root.path(), &[imported.file.reference.clone(), invalid])
                    .unwrap_err(),
                Error::InvalidReference
            );
            assert!(original.exists());
        }
        let wrong_ext = format!("drawing/references/{}.png", Uuid::new_v4());
        std::fs::copy(&original, root.path().join(&wrong_ext)).unwrap();
        assert!(matches!(read(root.path(), &wrong_ext), Err(Error::Corrupt)));
        let missing = format!("drawing/references/{}.webp", Uuid::new_v4());
        assert!(matches!(
            read(root.path(), &missing),
            Err(Error::Unavailable)
        ));
        remove_references(
            root.path(),
            &[
                imported.file.reference.clone(),
                imported.file.reference,
                missing,
            ],
        )
        .unwrap();
        assert!(!original.exists());
        assert!(root.path().join(wrong_ext).exists());
        assert_eq!(read_manifest(root.path(), &task).unwrap(), Some(files));
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
            std::fs::read_to_string(task_directory(root.path(), &task).unwrap().join("manifest.json"))
                .unwrap();
        assert!(!manifest.contains("prompt"));
        assert!(!manifest.contains("parameters"));
        assert!(!manifest.contains("data"));
    }

    #[test]
    fn new_outputs_are_flat_and_metadata_is_separate() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        let output = root.path().join("drawing");
        let original = output.join(format!("{task}_{}.png", files[0].id));
        assert_eq!(std::fs::read(&original).unwrap(), STANDARD.decode(input(20, ImageFormat::Png).data).unwrap());
        assert!(output.join("meta").join(&task).join("manifest.json").is_file());
        assert!(output.join("meta").join(&task).join("pending.json").is_file());
        assert!(!output.join(&task).exists());
        assert_eq!(std::fs::read_dir(&output).unwrap().count(), 2);
        assert!(thumbnail(root.path(), &files[0].reference).is_ok());
        let external = tempfile::tempdir().unwrap();
        export_png(root.path(), &files[0].reference, &external.path().join("export.png")).unwrap();
        discard_completed(root.path(), &task).unwrap();
        assert!(!original.exists());
        assert!(!output.join("meta").join(&task).exists());
    }

    #[test]
    fn legacy_task_layout_recovers_retries_reads_and_deletes_without_migration() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let directory = root.path().join("drawing").join(&task);
        std::fs::create_dir_all(&directory).unwrap();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        let original = root.path().join(&pending.files[0].file.reference);
        publish(&original, &bytes[0]).unwrap();
        assert_eq!(recover(root.path(), &task).unwrap(), None);
        let files = save(root.path(), &task, &images).unwrap();
        assert_eq!(files[0], pending.files[0].file);
        assert_eq!(std::fs::read(&original).unwrap(), bytes[0]);
        assert_eq!(save(root.path(), &task, &images).unwrap(), files);
        assert_eq!(recover(root.path(), &task).unwrap(), Some(files.clone()));
        assert_eq!(read(root.path(), &files[0].reference).unwrap().data, images[0].data);
        assert!(thumbnail(root.path(), &files[1].reference).is_ok());
        assert!(!root.path().join("drawing/meta").exists());
        discard_completed(root.path(), &task).unwrap();
        assert!(!directory.exists());
    }

    #[test]
    fn ambiguous_task_layouts_and_metadata_file_collisions_fail_without_writes() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png)];
        let files = save(root.path(), &task, &images).unwrap();
        let original = result_path(root.path(), &files[0].reference).unwrap();
        let before = std::fs::read(&original).unwrap();
        let legacy = root.path().join("drawing").join(&task);
        std::fs::create_dir(&legacy).unwrap();
        assert_eq!(save(root.path(), &task, &images).unwrap_err(), Error::Collision);
        assert_eq!(recover(root.path(), &task).unwrap_err(), Error::Collision);
        assert_eq!(discard_completed(root.path(), &task), Err(Error::Collision));
        assert_eq!(std::fs::read(&original).unwrap(), before);
        assert_eq!(std::fs::read_dir(&legacy).unwrap().count(), 0);

        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("drawing")).unwrap();
        std::fs::write(root.path().join("drawing/meta"), b"preserve").unwrap();
        assert_eq!(save(root.path(), &task, &images).unwrap_err(), Error::InvalidReference);
        assert_eq!(std::fs::read(root.path().join("drawing/meta")).unwrap(), b"preserve");
        assert_eq!(std::fs::read_dir(root.path().join("drawing")).unwrap().count(), 1);
    }

    #[test]
    fn legacy_and_new_reference_receipts_are_both_owned_and_duplicates_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let scope = sha256(b"test-scope");
        let bytes = STANDARD.decode(input(20, ImageFormat::Png).data).unwrap();
        let first = import_reference_scoped(root.path(), &bytes, &scope).unwrap();
        let current = reference_import_directory(root.path(), &scope).unwrap();
        assert!(current.starts_with(root.path().join("drawing/meta")));
        let legacy = root.path().join("drawing/reference-imports").join(&scope);
        std::fs::create_dir_all(&legacy).unwrap();
        let name = format!("{}.json", first.file.id);
        std::fs::rename(current.join(&name), legacy.join(&name)).unwrap();
        let second = import_reference_scoped(root.path(), &bytes, &scope).unwrap();
        let mut expected = vec![first.file.reference.clone(), second.file.reference.clone()];
        expected.sort();
        assert_eq!(list_references(root.path(), &scope).unwrap(), expected);
        std::fs::copy(legacy.join(&name), current.join(&name)).unwrap();
        assert_eq!(list_references(root.path(), &scope).unwrap_err(), Error::Collision);
        assert_eq!(remove_scoped_references(root.path(), &scope, &expected), Err(Error::Collision));
        assert!(root.path().join(&first.file.reference).exists());
        assert!(root.path().join(&second.file.reference).exists());
        std::fs::remove_file(current.join(&name)).unwrap();
        remove_scoped_references(root.path(), &scope, &expected).unwrap();
        assert!(list_references(root.path(), &scope).unwrap().is_empty());
        assert!(!root.path().join(&first.file.reference).exists());
        assert!(!root.path().join(&second.file.reference).exists());
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
    fn recovery_inventory_identifies_partial_and_complete_durable_originals() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Png)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        publish(
            &result_path(root.path(), &pending.files[1].file.reference).unwrap(),
            &bytes[1],
        )
        .unwrap();
        let partial = recovery_inventory(root.path(), &task).unwrap();
        assert_eq!(partial.total, 2);
        assert_eq!(partial.durable, vec![1]);
        publish(
            &result_path(root.path(), &pending.files[0].file.reference).unwrap(),
            &bytes[0],
        )
        .unwrap();
        assert_eq!(
            recovery_inventory(root.path(), &task).unwrap().durable,
            vec![0, 1]
        );
        assert!(read_manifest(root.path(), &task).unwrap().is_none());
        assert_eq!(recover(root.path(), &task).unwrap().unwrap().len(), 2);
        assert_eq!(
            recovery_inventory(root.path(), &task).unwrap().durable,
            vec![0, 1]
        );
    }

    #[test]
    fn discard_recovery_is_scoped_idempotent_and_rejects_untrusted_paths() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let other = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png)];
        save(root.path(), &task, &images).unwrap();
        let kept = save(root.path(), &other, &images).unwrap();
        assert!(discard_recovery(root.path(), "../outside").is_err());
        discard_recovery(root.path(), &task).unwrap();
        discard_recovery(root.path(), &task).unwrap();
        assert!(recover(root.path(), &task).unwrap().is_none());
        assert_eq!(recover(root.path(), &other).unwrap().unwrap(), kept);
    }

    #[test]
    fn resume_recovery_only_fills_matching_missing_receipt_entries() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Png)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        let first = result_path(root.path(), &pending.files[0].file.reference).unwrap();
        publish(&first, &bytes[0]).unwrap();
        assert!(
            resume_recovery(
                root.path(),
                &task,
                &[RecoveryImage {
                    index: 1,
                    image: input(40, ImageFormat::Png)
                }]
            )
            .is_err()
        );
        assert!(!result_path(root.path(), &pending.files[1].file.reference).unwrap().exists());
        let result = resume_recovery(
            root.path(),
            &task,
            &[RecoveryImage {
                index: 1,
                image: input(30, ImageFormat::Png),
            }],
        )
        .unwrap();
        assert_eq!(
            result.iter().map(|file| &file.id).collect::<Vec<_>>(),
            pending
                .files
                .iter()
                .map(|item| &item.file.id)
                .collect::<Vec<_>>()
        );
        assert_eq!(std::fs::read(first).unwrap(), bytes[0]);
        assert_eq!(resume_recovery(root.path(), &task, &[]).unwrap(), result);
    }

    #[test]
    fn corrupt_journal_prevents_discard_and_preserves_originals() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let (pending, bytes) = receipt(root.path(), &task, &[input(20, ImageFormat::Png)]);
        let original = result_path(root.path(), &pending.files[0].file.reference).unwrap();
        publish(&original, &bytes[0]).unwrap();
        let path = task_directory(root.path(), &task)
            .unwrap()
            .join("pending.json");
        std::fs::write(path, b"invalid JSON").unwrap();
        assert!(discard_recovery(root.path(), &task).is_err());
        assert_eq!(std::fs::read(original).unwrap(), bytes[0]);
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
                publish(&result_path(root.path(), &item.file.reference).unwrap(), &bytes).unwrap();
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
                2
            );
        }
    }

    #[test]
    fn pending_subset_remains_unpublished_then_matching_save_reuses_every_uuid() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        let first_path = result_path(root.path(), &pending.files[0].file.reference).unwrap();
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
            2
        );
    }

    #[test]
    fn pending_payload_collision_preserves_receipt_and_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let images = [input(20, ImageFormat::Png), input(30, ImageFormat::Jpeg)];
        let (pending, bytes) = receipt(root.path(), &task, &images);
        publish(
            &result_path(root.path(), &pending.files[0].file.reference).unwrap(),
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
                1
            );
        }
        assert_eq!(
            std::fs::read(result_path(root.path(), &pending.files[0].file.reference).unwrap()).unwrap(),
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
        let original = result_path(root.path(), &pending.files[0].file.reference).unwrap();
        let changed = STANDARD.decode(input(99, ImageFormat::Png).data).unwrap();
        publish(&original, &changed).unwrap();
        assert_eq!(recover(root.path(), &task).unwrap_err(), Error::Corrupt);
        assert_eq!(
            save(root.path(), &task, &images).unwrap_err(),
            Error::Corrupt
        );
        assert_eq!(std::fs::read(&original).unwrap(), changed);
        assert!(!result_path(root.path(), &pending.files[1].file.reference).unwrap().exists());
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
            2
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
        let original = result_path(root.path(), &files[0].reference).unwrap();
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

    fn exported_parameters(bytes: &[u8]) -> Option<serde_json::Value> {
        exported_parameter_chunks(bytes).remove("parameters")
    }

    fn exported_parameter_chunks(bytes: &[u8]) -> serde_json::Map<String, serde_json::Value> {
        let mut offset = 8;
        let mut result = serde_json::Map::new();
        while offset < bytes.len() {
            let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            let name = &bytes[offset + 4..offset + 8];
            let data = &bytes[offset + 8..offset + 8 + length];
            let checksum = u32::from_be_bytes(
                bytes[offset + 8 + length..offset + 12 + length]
                    .try_into()
                    .unwrap(),
            );
            assert_eq!(checksum, crc32(&bytes[offset + 4..offset + 8 + length]));
            if matches!(name, b"tEXt" | b"zTXt" | b"iTXt" | b"eXIf") {
                assert_eq!(name, b"iTXt");
                let separator = data.iter().position(|byte| *byte == 0).unwrap();
                let keyword = std::str::from_utf8(&data[..separator]).unwrap();
                assert!(matches!(keyword, "parameters" | "ayase_parameters"));
                assert_eq!(&data[separator..separator + 5], b"\0\0\0\0\0");
                assert!(
                    result
                        .insert(
                            keyword.into(),
                            serde_json::from_slice(&data[separator + 5..]).unwrap()
                        )
                        .is_none()
                );
            }
            offset += length + 12;
        }
        result
    }

    #[test]
    fn new_protocol_parameter_png_uses_only_ayase_namespace_and_plain_export_has_no_metadata() {
        let root = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let files = save(
            root.path(),
            &Uuid::new_v4().to_string(),
            &[input(20, ImageFormat::Png)],
        )
        .unwrap();
        let original = std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap();
        for (input, expected) in [
            (
                serde_json::json!({
                    "prompt": "透明的猫 🐈", "model": "synthetic-grok", "protocol": "grok-images",
                    "model_version": "2.0", "aspect_ratio": "21:9", "resolution": "2k", "quality": "medium"
                }),
                serde_json::json!({
                    "prompt": "透明的猫 🐈", "model": "synthetic-grok", "protocol": "grok-images",
                    "model_version": "2.0", "aspect_ratio": "21:9", "resolution": "2k", "quality": "medium"
                }),
            ),
            (
                serde_json::json!({
                    "prompt": "透明的猫 🐈", "model": "synthetic-seedream", "protocol": "seedream-images",
                    "model_version": "5.0-lite", "size": "2048x1536", "output_format": "jpeg", "watermark": false
                }),
                serde_json::json!({
                    "prompt": "透明的猫 🐈", "model": "synthetic-seedream", "protocol": "seedream-images",
                    "model_version": "5.0-lite", "size": "2048x1536", "output_format": "jpeg", "watermark": false
                }),
            ),
        ] {
            let parameters: DrawingExportParameters = serde_json::from_value(input).unwrap();
            let destination = output.path().join(format!("{}.png", parameters.protocol));
            export_png_with_parameters(
                root.path(),
                &files[0].reference,
                &destination,
                Some(&parameters),
            )
            .unwrap();
            let bytes = std::fs::read(&destination).unwrap();
            let chunks = exported_parameter_chunks(&bytes);
            assert_eq!(chunks.len(), 1);
            assert!(!chunks.contains_key("parameters"));
            assert_eq!(chunks.get("ayase_parameters"), Some(&expected));
            assert!(chunks["ayase_parameters"].get("api_type").is_none());
            assert_eq!(
                decode_image(&bytes, "image/png").unwrap().to_rgba8(),
                decode_image(&original, "image/png").unwrap().to_rgba8()
            );
            export_png(root.path(), &files[0].reference, &destination).unwrap();
            assert!(exported_parameter_chunks(&std::fs::read(destination).unwrap()).is_empty());
        }
        assert_eq!(
            std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap(),
            original
        );
    }

    #[test]
    fn new_protocol_export_omits_auto_fields_and_preserves_explicit_profiles() {
        for profile in ["legacy", "2.0"] {
            for ratio in [
                "auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9",
                "9:19.5", "20:9", "9:20", "21:9", "5:2",
            ] {
                let mut input = serde_json::json!({
                    "prompt": "test", "model": "synthetic", "protocol": "grok-images",
                    "model_version": profile, "aspect_ratio": ratio, "resolution": "auto"
                });
                if profile == "2.0" {
                    input["quality"] = "auto".into();
                }
                let parameters: DrawingExportParameters = serde_json::from_value(input).unwrap();
                if profile == "legacy" && matches!(ratio, "21:9" | "5:2") {
                    assert_eq!(parameters.json(), Err(Error::InvalidParameters));
                    continue;
                }
                let mut expected = serde_json::json!({
                    "prompt": "test", "model": "synthetic", "protocol": "grok-images", "model_version": profile
                });
                if ratio != "auto" {
                    expected["aspect_ratio"] = ratio.into();
                }
                assert_eq!(
                    serde_json::from_slice::<serde_json::Value>(&parameters.json().unwrap())
                        .unwrap(),
                    expected
                );
            }
        }
        for profile in ["4.0", "4.5", "5.0-lite", "5.0-pro", "5.0-flash"] {
            for watermark in [false, true] {
                let mut input = serde_json::json!({
                    "prompt": "test", "model": "synthetic", "protocol": "seedream-images",
                    "model_version": profile, "size": "auto", "watermark": watermark
                });
                if profile.starts_with("5.0-") {
                    input["output_format"] = "auto".into();
                }
                let parameters: DrawingExportParameters = serde_json::from_value(input).unwrap();
                assert_eq!(
                    serde_json::from_slice::<serde_json::Value>(&parameters.json().unwrap())
                        .unwrap(),
                    serde_json::json!({
                        "prompt": "test", "model": "synthetic", "protocol": "seedream-images",
                        "model_version": profile, "watermark": watermark
                    })
                );
            }
        }
    }

    #[test]
    fn new_protocol_export_rejects_invalid_parameters_without_writes() {
        let root = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let files = save(
            root.path(),
            &Uuid::new_v4().to_string(),
            &[input(20, ImageFormat::Png)],
        )
        .unwrap();
        let destination = output.path().join("refused.png");
        let mut cases = Vec::new();
        for (protocol, profile, forbidden) in [
            (
                "grok-images",
                "2.0",
                vec![
                    serde_json::json!({"size": "1024x1024"}),
                    serde_json::json!({"output_format": "png"}),
                    serde_json::json!({"watermark": false}),
                    serde_json::json!({"aspect_ratio": "100:1"}),
                    serde_json::json!({"aspect_ratio": " "}),
                    serde_json::json!({"resolution": "2K"}),
                    serde_json::json!({"quality": "high"}),
                    serde_json::json!({"model_version": "future"}),
                    serde_json::json!({"model_version": "legacy", "quality": "auto"}),
                    serde_json::json!({"model_version": "legacy", "quality": "low"}),
                    serde_json::json!({"model_version": "legacy", "aspect_ratio": "21:9"}),
                    serde_json::json!({"model_version": "legacy", "aspect_ratio": "5:2"}),
                ],
            ),
            (
                "seedream-images",
                "5.0-lite",
                vec![
                    serde_json::json!({"aspect_ratio": "auto"}),
                    serde_json::json!({"resolution": "auto"}),
                    serde_json::json!({"quality": "auto"}),
                    serde_json::json!({"size": " "}),
                    serde_json::json!({"output_format": "webp"}),
                    serde_json::json!({"model_version": "future"}),
                    serde_json::json!({"model_version": "4.0", "output_format": "auto"}),
                    serde_json::json!({"model_version": "4.5", "output_format": "png"}),
                ],
            ),
        ] {
            let base = serde_json::json!({
                "prompt": "test", "model": "synthetic", "protocol": protocol, "model_version": profile
            });
            for extra in forbidden.into_iter().chain([
                serde_json::json!({"api_type": "gpt"}),
                serde_json::json!({"api_type": "gemini"}),
                serde_json::json!({"temperature": 1}),
                serde_json::json!({"safety_threshold": "OFF"}),
                serde_json::json!({"response_modalities": ["IMAGE"]}),
                serde_json::json!({"model_version": null}),
                serde_json::json!({"model": " "}),
            ]) {
                let mut value = base.clone();
                value
                    .as_object_mut()
                    .unwrap()
                    .extend(extra.as_object().unwrap().clone());
                cases.push(value);
            }
            for key in [
                "api_key",
                "api_url",
                "base_url",
                "connectionId",
                "reference",
                "output_dir",
                "unexpected",
            ] {
                let mut value = base.clone();
                value[key] = "SECRET-C:/private/file.png".into();
                assert!(
                    serde_json::from_value::<DrawingExportParameters>(value).is_err(),
                    "{key}"
                );
            }
            for extra in [
                serde_json::json!({"watermark": "false"}),
                serde_json::json!({"model_version": 2}),
                serde_json::json!({"output_format": true}),
            ] {
                let mut value = base.clone();
                value
                    .as_object_mut()
                    .unwrap()
                    .extend(extra.as_object().unwrap().clone());
                assert!(
                    serde_json::from_value::<DrawingExportParameters>(value).is_err(),
                    "{extra}"
                );
            }
        }
        for protocol in ["gemini-image", "openai-images"] {
            for extra in [
                serde_json::json!({"model_version": "2.0"}),
                serde_json::json!({"output_format": "png"}),
                serde_json::json!({"watermark": false}),
            ] {
                let mut value = serde_json::json!({"prompt": "test", "model": "synthetic", "protocol": protocol});
                value
                    .as_object_mut()
                    .unwrap()
                    .extend(extra.as_object().unwrap().clone());
                cases.push(value);
            }
        }
        for value in cases {
            let parameters: DrawingExportParameters =
                serde_json::from_value(value.clone()).unwrap();
            assert_eq!(
                export_png_with_parameters(
                    root.path(),
                    &files[0].reference,
                    &destination,
                    Some(&parameters)
                ),
                Err(Error::InvalidParameters),
                "{value}"
            );
            assert!(!destination.exists());
            std::fs::write(&destination, b"existing-export").unwrap();
            assert_eq!(
                export_png_with_parameters(
                    root.path(),
                    &files[0].reference,
                    &destination,
                    Some(&parameters)
                ),
                Err(Error::InvalidParameters),
                "{value}"
            );
            assert_eq!(std::fs::read(&destination).unwrap(), b"existing-export");
            std::fs::remove_file(&destination).unwrap();
        }
    }

    #[test]
    fn parameter_export_is_utf8_json_and_preserves_alpha_without_source_metadata() {
        let root = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            3,
            2,
            image::Rgba([20, 40, 90, 70]),
        ));
        let mut encoded = Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let mut bytes = encoded.into_inner();
        bytes.splice(33..33, png_chunk(b"tEXt", b"api_key\0SOURCE-SECRET"));
        let files = save(
            root.path(),
            &task,
            &[DrawingImageInput {
                mime: "image/png".into(),
                data: STANDARD.encode(&bytes),
            }],
        )
        .unwrap();
        let parameters: DrawingExportParameters = serde_json::from_value(serde_json::json!({
            "prompt": "透明的猫 🐈\n他说：\"你好\" \\ 雪",
            "model": "synthetic-image", "protocol": "gemini-image", "aspect_ratio": "3:2", "resolution": "2K"
        })).unwrap();
        let destination = output.path().join("parameters.png");
        export_png_with_parameters(
            root.path(),
            &files[0].reference,
            &destination,
            Some(&parameters),
        )
        .unwrap();
        let exported = std::fs::read(&destination).unwrap();
        assert_eq!(
            exported_parameters(&exported),
            Some(serde_json::json!({
                "prompt": parameters.prompt, "model": "synthetic-image", "protocol": "gemini-image",
                "api_type": "gemini", "aspect_ratio": "3:2", "resolution": "2K"
            }))
        );
        assert!(!exported.windows(13).any(|value| value == b"SOURCE-SECRET"));
        assert_eq!(
            decode_image(&exported, "image/png").unwrap().to_rgba8(),
            image.to_rgba8()
        );
        let plain = output.path().join("plain.png");
        export_png(root.path(), &files[0].reference, &plain).unwrap();
        let plain_bytes = std::fs::read(&plain).unwrap();
        assert_eq!(exported_parameters(&plain_bytes), None);
        assert_eq!(
            decode_image(&plain_bytes, "image/png").unwrap().to_rgba8(),
            image.to_rgba8()
        );
        assert_eq!(
            std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap(),
            bytes
        );
        assert_eq!(
            export_png_with_parameters(
                root.path(),
                &files[0].reference,
                &root.path().join("forbidden.png"),
                Some(&parameters)
            ),
            Err(Error::InvalidReference)
        );
        // Opt-in local fixtures let the primary verify with GNBP's actual Pillow reader.
        if let Some(directory) = std::env::var_os("AYASE_DRAWING_EXPORT_FIXTURE_DIR") {
            let directory = PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::copy(destination, directory.join("parameters.png")).unwrap();
            std::fs::copy(plain, directory.join("plain.png")).unwrap();
        }
    }

    #[test]
    fn export_parameters_reject_unknown_sensitive_fields_and_protocol_mismatch() {
        let base = serde_json::json!({ "prompt": "test", "model": "synthetic", "protocol": "openai-images" });
        for key in [
            "api_key",
            "api_url",
            "reference",
            "ref_images",
            "output_dir",
            "unexpected",
        ] {
            let mut value = base.clone();
            value[key] = "SECRET-C:/private/file.png".into();
            assert!(
                serde_json::from_value::<DrawingExportParameters>(value).is_err(),
                "{key}"
            );
        }
        for extra in [
            serde_json::json!({ "protocol": "other" }),
            serde_json::json!({ "aspect_ratio": "1:1" }),
            serde_json::json!({ "resolution": "1K" }),
            serde_json::json!({ "model": " " }),
            serde_json::json!({ "quality": " " }),
            serde_json::json!({ "api_type": "gemini" }),
            serde_json::json!({ "protocol": "gemini-image", "size": "1024x1024" }),
            serde_json::json!({ "protocol": "gemini-image", "quality": "high" }),
        ] {
            let mut value = base.clone();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let parameters: DrawingExportParameters = serde_json::from_value(value).unwrap();
            assert_eq!(parameters.json(), Err(Error::InvalidParameters));
        }
        for (protocol, extra, api_type) in [
            (
                "gemini-image",
                serde_json::json!({"aspect_ratio": "auto", "resolution": "auto"}),
                "gemini",
            ),
            (
                "openai-images",
                serde_json::json!({"size": "auto", "quality": "auto"}),
                "gpt",
            ),
        ] {
            let mut value = base.clone();
            value["protocol"] = protocol.into();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let parameters: DrawingExportParameters = serde_json::from_value(value).unwrap();
            let value: serde_json::Value =
                serde_json::from_slice(&parameters.json().unwrap()).unwrap();
            assert_eq!(
                value,
                serde_json::json!({"prompt": "test", "model": "synthetic", "protocol": protocol, "api_type": api_type})
            );
        }
    }

    #[test]
    fn gemini_export_parameters_preserve_explicit_advanced_options() {
        for threshold in [
            "BLOCK_NONE",
            "BLOCK_ONLY_HIGH",
            "BLOCK_MEDIUM_AND_ABOVE",
            "BLOCK_LOW_AND_ABOVE",
            "OFF",
        ] {
            for temperature in [0.0, 2.0] {
                for modalities in [
                    serde_json::json!(["IMAGE"]),
                    serde_json::json!(["TEXT", "IMAGE"]),
                ] {
                    let input = serde_json::json!({
                        "prompt": "test", "model": "synthetic", "protocol": "gemini-image",
                        "aspect_ratio": "auto", "resolution": "auto",
                        "temperature": temperature, "safety_threshold": threshold,
                        "response_modalities": modalities
                    });
                    let parameters: DrawingExportParameters =
                        serde_json::from_value(input).unwrap();
                    let value: serde_json::Value =
                        serde_json::from_slice(&parameters.json().unwrap()).unwrap();
                    assert_eq!(
                        value,
                        serde_json::json!({
                            "prompt": "test", "model": "synthetic", "protocol": "gemini-image",
                            "api_type": "gemini", "temperature": temperature,
                            "safety_threshold": threshold, "response_modalities": modalities
                        })
                    );
                }
            }
        }
        for protocol in ["gemini-image", "openai-images"] {
            let parameters: DrawingExportParameters = serde_json::from_value(serde_json::json!({
                "prompt": "test", "model": "synthetic", "protocol": protocol,
                "temperature": null, "safety_threshold": null, "response_modalities": null
            }))
            .unwrap();
            let value: serde_json::Value =
                serde_json::from_slice(&parameters.json().unwrap()).unwrap();
            assert_eq!(
                value,
                serde_json::json!({
                    "prompt": "test", "model": "synthetic", "protocol": protocol,
                    "api_type": if protocol == "gemini-image" { "gemini" } else { "gpt" }
                })
            );
        }
    }

    #[test]
    fn advanced_export_parameters_reject_invalid_values_and_wrong_protocol() {
        let base = serde_json::json!({
            "prompt": "test", "model": "synthetic", "protocol": "gemini-image"
        });
        for extra in [
            serde_json::json!({"temperature": -0.01}),
            serde_json::json!({"temperature": 2.01}),
            serde_json::json!({"response_modalities": []}),
            serde_json::json!({"response_modalities": ["TEXT"]}),
            serde_json::json!({"response_modalities": ["IMAGE", "TEXT"]}),
            serde_json::json!({"response_modalities": ["IMAGE", "IMAGE"]}),
            serde_json::json!({"response_modalities": ["TEXT", "IMAGE", "IMAGE"]}),
            serde_json::json!({"protocol": "openai-images", "size": "auto", "temperature": 0}),
            serde_json::json!({"protocol": "openai-images", "quality": "high", "safety_threshold": "OFF"}),
            serde_json::json!({"protocol": "openai-images", "response_modalities": ["IMAGE"]}),
        ] {
            let mut value = base.clone();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let parameters: DrawingExportParameters = serde_json::from_value(value).unwrap();
            assert_eq!(parameters.json(), Err(Error::InvalidParameters), "{extra}");
        }
        for temperature in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut parameters: DrawingExportParameters =
                serde_json::from_value(base.clone()).unwrap();
            parameters.temperature = Some(temperature);
            assert_eq!(parameters.json(), Err(Error::InvalidParameters));
        }
        for extra in [
            serde_json::json!({"temperature": "1"}),
            serde_json::json!({"temperature": true}),
            serde_json::json!({"temperature": []}),
            serde_json::json!({"safety_threshold": "BLOCK_UNSPECIFIED"}),
            serde_json::json!({"safety_threshold": "off"}),
            serde_json::json!({"safety_threshold": 0}),
            serde_json::json!({"response_modalities": "IMAGE"}),
            serde_json::json!({"response_modalities": ["AUDIO"]}),
            serde_json::json!({"response_modalities": [null]}),
        ] {
            let mut value = base.clone();
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert!(
                serde_json::from_value::<DrawingExportParameters>(value).is_err(),
                "{extra}"
            );
        }
    }

    #[test]
    fn advanced_parameter_png_contains_exact_fields_and_invalid_exports_write_nothing() {
        let root = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let files = save(
            root.path(),
            &Uuid::new_v4().to_string(),
            &[input(20, ImageFormat::Png)],
        )
        .unwrap();
        let input = serde_json::json!({
            "prompt": "透明的猫 🐈", "model": "synthetic", "protocol": "gemini-image",
            "aspect_ratio": "auto", "resolution": "2K", "temperature": 0.0,
            "safety_threshold": "BLOCK_ONLY_HIGH", "response_modalities": ["IMAGE"]
        });
        let mut parameters: DrawingExportParameters =
            serde_json::from_value(input.clone()).unwrap();
        let destination = output.path().join("advanced-parameters.png");
        export_png_with_parameters(
            root.path(),
            &files[0].reference,
            &destination,
            Some(&parameters),
        )
        .unwrap();
        let bytes = std::fs::read(&destination).unwrap();
        assert_eq!(
            exported_parameters(&bytes),
            Some(serde_json::json!({
                "prompt": "透明的猫 🐈", "model": "synthetic", "protocol": "gemini-image",
                "api_type": "gemini", "resolution": "2K", "temperature": 0.0,
                "safety_threshold": "BLOCK_ONLY_HIGH", "response_modalities": ["IMAGE"]
            }))
        );
        let original = std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap();
        assert_eq!(
            decode_image(&bytes, "image/png").unwrap().to_rgba8(),
            decode_image(&original, "image/png").unwrap().to_rgba8()
        );
        if let Some(directory) = std::env::var_os("AYASE_DRAWING_EXPORT_FIXTURE_DIR") {
            let directory = PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::copy(&destination, directory.join("advanced-parameters.png")).unwrap();
        }
        for temperature in [-0.01, 2.01, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            parameters.temperature = Some(temperature);
            assert_eq!(
                export_png_with_parameters(
                    root.path(),
                    &files[0].reference,
                    &destination,
                    Some(&parameters)
                ),
                Err(Error::InvalidParameters)
            );
            assert_eq!(std::fs::read(&destination).unwrap(), bytes);
        }
        for extra in [
            serde_json::json!({"response_modalities": ["TEXT"]}),
            serde_json::json!({"protocol": "openai-images", "temperature": 0.0}),
            serde_json::json!({"protocol": "openai-images", "safety_threshold": "OFF"}),
            serde_json::json!({"protocol": "openai-images", "response_modalities": ["IMAGE"]}),
        ] {
            let mut value = serde_json::json!({
                "prompt": "test", "model": "synthetic", "protocol": "gemini-image"
            });
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let parameters: DrawingExportParameters = serde_json::from_value(value).unwrap();
            let refused = output.path().join("refused.png");
            assert_eq!(
                export_png_with_parameters(
                    root.path(),
                    &files[0].reference,
                    &refused,
                    Some(&parameters)
                ),
                Err(Error::InvalidParameters)
            );
            assert!(!refused.exists());
        }
    }

    #[test]
    fn thumbnails_contain_without_upscaling_preserve_alpha_and_never_write_cache() {
        let root = tempfile::tempdir().unwrap();
        for (width, height, expected) in [
            (640, 320, (256, 128)),
            (320, 640, (128, 256)),
            (3, 2, (3, 2)),
        ] {
            let task = Uuid::new_v4().to_string();
            let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                width,
                height,
                image::Rgba([20, 40, 90, 70]),
            ));
            let mut bytes = Cursor::new(Vec::new());
            image.write_to(&mut bytes, ImageFormat::Png).unwrap();
            let bytes = bytes.into_inner();
            let files = save(
                root.path(),
                &task,
                &[DrawingImageInput {
                    mime: "image/png".into(),
                    data: STANDARD.encode(&bytes),
                }],
            )
            .unwrap();
            let before = std::fs::read_dir(task_directory(root.path(), &task).unwrap())
                .unwrap()
                .count();
            for _ in 0..2 {
                let derived = thumbnail(root.path(), &files[0].reference).unwrap();
                assert_eq!(derived.mime, "image/png");
                let decoded = decode_image(&STANDARD.decode(derived.data).unwrap(), &derived.mime)
                    .unwrap()
                    .to_rgba8();
                assert_eq!(decoded.dimensions(), expected);
                assert!(decoded.pixels().all(|pixel| pixel.0 == [20, 40, 90, 70]));
            }
            assert_eq!(
                std::fs::read_dir(task_directory(root.path(), &task).unwrap())
                    .unwrap()
                    .count(),
                before
            );
            assert_eq!(
                std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap(),
                bytes
            );
        }
        assert!(matches!(
            thumbnail(root.path(), "../private.png"),
            Err(Error::InvalidReference)
        ));
        assert!(matches!(
            thumbnail(
                root.path(),
                &format!("drawing/references/{}.png", Uuid::new_v4())
            ),
            Err(Error::Unavailable)
        ));
    }

    #[test]
    fn reference_thumbnails_preserve_originals_alpha_and_validate_paths() {
        let root = tempfile::tempdir().unwrap();
        for (width, height, expected) in [(640, 320, (256, 128)), (3, 2, (3, 2))] {
            let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                width, height, image::Rgba([20, 40, 90, 70]),
            ));
            let mut bytes = Cursor::new(Vec::new());
            image.write_to(&mut bytes, ImageFormat::Png).unwrap();
            let bytes = bytes.into_inner();
            let imported = import_reference(root.path(), &DrawingImageInput {
                mime: "image/png".into(), data: STANDARD.encode(&bytes),
            }).unwrap();
            let derived = thumbnail(root.path(), &imported.file.reference).unwrap();
            let decoded = decode_image(&STANDARD.decode(derived.data).unwrap(), &derived.mime).unwrap().to_rgba8();
            assert_eq!(decoded.dimensions(), expected);
            assert!(decoded.pixels().all(|pixel| pixel.0 == [20, 40, 90, 70]));
            assert_eq!(std::fs::read(root.path().join(&imported.file.reference)).unwrap(), bytes);
            let wrong = imported.file.reference.replace(".png", ".jpg");
            std::fs::write(root.path().join(&wrong), &bytes).unwrap();
            assert!(matches!(thumbnail(root.path(), &wrong), Err(Error::Corrupt)));
            std::fs::write(root.path().join(&imported.file.reference), b"corrupt").unwrap();
            assert!(matches!(thumbnail(root.path(), &imported.file.reference), Err(Error::Corrupt)));
        }
        assert!(matches!(thumbnail(root.path(), "drawing/references/../../private.png"), Err(Error::InvalidReference)));
    }

    #[test]
    fn requested_result_remains_readable_with_missing_sibling_but_recovery_stays_strict() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(
            root.path(),
            &task,
            &[input(20, ImageFormat::Png), input(80, ImageFormat::Png)],
        )
        .unwrap();
        std::fs::remove_file(result_path(root.path(), &files[1].reference).unwrap()).unwrap();
        assert!(read(root.path(), &files[0].reference).is_ok());
        assert!(thumbnail(root.path(), &files[0].reference).is_ok());
        assert!(matches!(
            thumbnail(root.path(), &files[1].reference),
            Err(Error::Unavailable)
        ));
        assert_eq!(
            read_manifest(root.path(), &task).unwrap_err(),
            Error::Unavailable
        );
        std::fs::write(result_path(root.path(), &files[0].reference).unwrap(), b"corrupt").unwrap();
        assert!(matches!(
            thumbnail(root.path(), &files[0].reference),
            Err(Error::Corrupt)
        ));
    }

    #[test]
    fn completed_cleanup_requires_valid_manifest_and_reconciled_receipt_before_deleting() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        assert_eq!(
            discard_completed(root.path(), &task),
            Err(Error::Unavailable)
        );
        let (pending, bytes) = receipt(root.path(), &task, &[input(20, ImageFormat::Png)]);
        let original = result_path(root.path(), &pending.files[0].file.reference).unwrap();
        std::fs::write(&original, &bytes[0]).unwrap();
        assert_eq!(
            discard_completed(root.path(), &task),
            Err(Error::Unavailable)
        );
        let files = recover(root.path(), &task).unwrap().unwrap();
        let directory = task_directory(root.path(), &task).unwrap();
        let manifest_path = directory.join("manifest.json");
        let manifest_bytes = std::fs::read(&manifest_path).unwrap();
        std::fs::write(&manifest_path, b"broken").unwrap();
        assert_eq!(discard_completed(root.path(), &task), Err(Error::Corrupt));
        assert!(original.exists());
        std::fs::write(&manifest_path, &manifest_bytes).unwrap();
        let pending_path = directory.join("pending.json");
        let pending_bytes = std::fs::read(&pending_path).unwrap();
        std::fs::write(&pending_path, b"broken").unwrap();
        assert_eq!(discard_completed(root.path(), &task), Err(Error::Corrupt));
        assert!(original.exists());
        let mut conflicting: Pending = serde_json::from_slice(&pending_bytes).unwrap();
        conflicting.files[0].sha256 = "0".repeat(64);
        std::fs::write(&pending_path, serde_json::to_vec(&conflicting).unwrap()).unwrap();
        assert_eq!(discard_completed(root.path(), &task), Err(Error::Corrupt));
        assert!(original.exists());
        conflicting.files[0].file.id = Uuid::new_v4().to_string();
        conflicting.files[0].file.reference =
            format!("drawing/{task}/{}.png", conflicting.files[0].file.id);
        std::fs::write(&pending_path, serde_json::to_vec(&conflicting).unwrap()).unwrap();
        assert_eq!(discard_completed(root.path(), &task), Err(Error::Collision));
        assert!(original.exists());
        std::fs::write(&pending_path, &pending_bytes).unwrap();
        std::fs::remove_file(&original).unwrap();
        assert_eq!(
            discard_completed(root.path(), &task),
            Err(Error::Unavailable)
        );
        assert!(manifest_path.exists());
        std::fs::write(result_path(root.path(), &files[0].reference).unwrap(), &bytes[0]).unwrap();
        discard_completed(root.path(), &task).unwrap();
        assert!(!directory.exists());
    }

    #[test]
    fn default_cleanup_preserves_completed_originals_when_receipt_is_damaged_or_conflicting() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        let directory = task_directory(root.path(), &task).unwrap();
        let original = result_path(root.path(), &files[0].reference).unwrap();
        let original_bytes = std::fs::read(&original).unwrap();
        let manifest_path = directory.join("manifest.json");
        let manifest_bytes = std::fs::read(&manifest_path).unwrap();
        let pending_path = directory.join("pending.json");
        let pending_bytes = std::fs::read(&pending_path).unwrap();
        let mut wrong_hash: Pending = serde_json::from_slice(&pending_bytes).unwrap();
        wrong_hash.files[0].sha256 = "0".repeat(64);
        let mut wrong_file: Pending = serde_json::from_slice(&pending_bytes).unwrap();
        wrong_file.files[0].file.id = Uuid::new_v4().to_string();
        wrong_file.files[0].file.reference =
            format!("drawing/{task}/{}.png", wrong_file.files[0].file.id);
        for (receipt, expected) in [
            (b"broken".to_vec(), Error::Corrupt),
            (serde_json::to_vec(&wrong_hash).unwrap(), Error::Corrupt),
            (serde_json::to_vec(&wrong_file).unwrap(), Error::Collision),
        ] {
            std::fs::write(&pending_path, &receipt).unwrap();
            // Omitted and false completedOnly both dispatch this default path.
            assert_eq!(discard_recovery(root.path(), &task), Err(expected));
            assert_eq!(std::fs::read(&original).unwrap(), original_bytes);
            assert_eq!(std::fs::read(&manifest_path).unwrap(), manifest_bytes);
            assert_eq!(std::fs::read(&pending_path).unwrap(), receipt);
        }
        std::fs::write(&pending_path, &pending_bytes).unwrap();
        discard_recovery(root.path(), &task).unwrap();
        assert!(!directory.exists());
    }

    #[test]
    fn tampered_manifest_and_missing_original_fail_recovery() {
        let root = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        let manifest = task_directory(root.path(), &task).unwrap().join("manifest.json");
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
        std::fs::remove_file(result_path(root.path(), &files[0].reference).unwrap()).unwrap();
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
        assert_eq!(output_directory(root.path()).unwrap_err(), Error::InvalidReference);
        assert_eq!(
            save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap_err(),
            Error::InvalidReference
        );
        assert_eq!(
            read_manifest(root.path(), &task).unwrap_err(),
            Error::InvalidReference
        );
        let value = format!("drawing/references/{}.png", Uuid::new_v4());
        assert_eq!(
            import_reference(root.path(), &input(20, ImageFormat::Png)).unwrap_err(),
            Error::InvalidReference
        );
        assert!(matches!(
            read(root.path(), &value),
            Err(Error::InvalidReference)
        ));
        assert_eq!(
            remove_references(root.path(), &[value]).unwrap_err(),
            Error::InvalidReference
        );
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
        #[cfg(windows)]
        std::fs::remove_dir(&linked).unwrap();
    }

    #[test]
    fn output_directory_creates_only_the_fixed_directory_and_preserves_existing_outputs() {
        let root = tempfile::tempdir().unwrap();
        let directory = output_directory(root.path()).unwrap();
        assert_eq!(directory, root.path().join("drawing"));
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
        let task = Uuid::new_v4().to_string();
        let files = save(root.path(), &task, &[input(20, ImageFormat::Png)]).unwrap();
        let original = std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap();
        assert_eq!(output_directory(root.path()).unwrap(), directory);
        assert_eq!(std::fs::read(result_path(root.path(), &files[0].reference).unwrap()).unwrap(), original);
    }

    #[test]
    fn output_directory_refuses_a_file_in_place_of_the_directory_without_writes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("drawing");
        std::fs::write(&path, b"keep existing bytes").unwrap();
        assert_eq!(output_directory(root.path()).unwrap_err(), Error::InvalidReference);
        assert_eq!(std::fs::read(&path).unwrap(), b"keep existing bytes");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
