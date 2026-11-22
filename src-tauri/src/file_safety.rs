//! Shared path-link inspection and bounded file reads for managed storage modules.
use std::{
    fs::{Metadata, OpenOptions},
    io::Read,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum FileSafetyError {
    InvalidPath,
    Unavailable,
    TooLarge,
    Storage,
}

pub(crate) fn is_link(metadata: &Metadata) -> bool {
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

// Inspect every ancestor without following links, rejecting Windows reparse points.
// A missing suffix returns Ok(None) for new files and idempotent cleanup.
pub(crate) fn inspect(path: &Path) -> Result<Option<Metadata>, FileSafetyError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(FileSafetyError::InvalidPath);
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if !current.is_absolute() {
            continue;
        }
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if is_link(&metadata) || (current != path && !metadata.is_dir()) {
                    return Err(FileSafetyError::InvalidPath);
                }
                if current == path {
                    return Ok(Some(metadata));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(FileSafetyError::Storage),
        }
    }
    Err(FileSafetyError::InvalidPath)
}

pub(crate) fn checked_read(path: &Path, limit: Option<u64>) -> Result<Vec<u8>, FileSafetyError> {
    let metadata = inspect(path)?.ok_or(FileSafetyError::Unavailable)?;
    if !metadata.is_file() {
        return Err(FileSafetyError::InvalidPath);
    }
    if limit.is_some_and(|limit| metadata.len() > limit) {
        return Err(FileSafetyError::TooLarge);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path).map_err(|_| FileSafetyError::Unavailable)?;
    let metadata = file.metadata().map_err(|_| FileSafetyError::Storage)?;
    if is_link(&metadata) || !metadata.is_file() {
        return Err(FileSafetyError::InvalidPath);
    }
    if limit.is_some_and(|limit| metadata.len() > limit) {
        return Err(FileSafetyError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(limit.map_or(u64::MAX, |limit| limit.saturating_add(1)))
        .read_to_end(&mut bytes)
        .map_err(|_| FileSafetyError::Storage)?;
    if limit.is_some_and(|limit| bytes.len() as u64 > limit) {
        return Err(FileSafetyError::TooLarge);
    }
    Ok(bytes)
}

pub(crate) fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>, FileSafetyError> {
    checked_read(path, Some(limit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_rejects_relative_and_traversal_paths_and_allows_missing_suffix() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            inspect(Path::new("relative/file.txt")).unwrap_err(),
            FileSafetyError::InvalidPath
        );
        assert_eq!(
            inspect(&temp.path().join("a").join("..").join("b")).unwrap_err(),
            FileSafetyError::InvalidPath
        );
        assert!(inspect(&temp.path().join("missing/nested/file.txt"))
            .unwrap()
            .is_none());
        let file = temp.path().join("plain.txt");
        std::fs::write(&file, b"ok").unwrap();
        assert!(inspect(&file).unwrap().is_some_and(|m| m.is_file()));
        assert_eq!(
            inspect(&file.join("child.txt")).unwrap_err(),
            FileSafetyError::InvalidPath
        );
    }

    #[test]
    fn bounded_read_enforces_exact_limit_and_rejects_directories_and_missing_files() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("sample.bin");
        std::fs::write(&file, b"12345").unwrap();
        assert_eq!(bounded_read(&file, 5), Ok(b"12345".to_vec()));
        assert_eq!(bounded_read(&file, 4), Err(FileSafetyError::TooLarge));
        assert_eq!(checked_read(&file, None), Ok(b"12345".to_vec()));
        assert_eq!(bounded_read(temp.path(), 16), Err(FileSafetyError::InvalidPath));
        assert_eq!(
            bounded_read(&temp.path().join("absent.bin"), 16),
            Err(FileSafetyError::Unavailable)
        );
    }
}
