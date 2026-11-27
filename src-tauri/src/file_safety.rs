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

#[cfg(windows)]
mod windows_reparse {
    use std::{
        ffi::c_void,
        fs::{File, Metadata, OpenOptions},
        os::windows::{
            fs::{MetadataExt, OpenOptionsExt},
            io::AsRawHandle,
        },
        path::Path,
    };

    use super::FileSafetyError;

    pub(super) const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    pub(super) const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_TAG_INFO_CLASS: u32 = 9;

    pub(super) const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
    pub(super) const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;
    pub(super) const REPARSE_TAG_NAME_SURROGATE_BIT: u32 = 0x2000_0000;
    pub(super) const IO_REPARSE_TAG_WOF: u32 = 0x8000_0017;
    pub(super) const IO_REPARSE_TAG_CLOUD_BASE: u32 = 0x9000_001A;
    pub(super) const IO_REPARSE_TAG_CLOUD_MASK: u32 = 0x0000_F000;

    #[repr(C)]
    struct FileAttributeTagInfo {
        file_attributes: u32,
        reparse_tag: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandleEx(
            file: *mut c_void,
            info_class: u32,
            info: *mut c_void,
            buffer_size: u32,
        ) -> i32;
    }

    pub(super) fn is_allowed_reparse_tag(tag: u32) -> bool {
        if tag == IO_REPARSE_TAG_SYMLINK
            || tag == IO_REPARSE_TAG_MOUNT_POINT
            || (tag & REPARSE_TAG_NAME_SURROGATE_BIT) != 0
        {
            return false;
        }
        tag == IO_REPARSE_TAG_WOF
            || (tag & !IO_REPARSE_TAG_CLOUD_MASK) == IO_REPARSE_TAG_CLOUD_BASE
    }

    pub(super) fn has_reparse_point(metadata: &Metadata) -> bool {
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    fn query_handle_tag(handle: *mut c_void) -> Result<FileAttributeTagInfo, FileSafetyError> {
        let mut info = FileAttributeTagInfo {
            file_attributes: 0,
            reparse_tag: 0,
        };
        // SAFETY: info is aligned and sized for FileAttributeTagInfo.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FILE_ATTRIBUTE_TAG_INFO_CLASS,
                (&mut info as *mut FileAttributeTagInfo).cast::<c_void>(),
                std::mem::size_of::<FileAttributeTagInfo>() as u32,
            )
        };
        if ok == 0 {
            return Err(FileSafetyError::InvalidPath);
        }
        Ok(info)
    }

    pub(super) fn query_path_reparse_tag(path: &Path) -> Result<Option<u32>, FileSafetyError> {
        // Use std::fs::OpenOptions so Rust std handles extended-length Windows paths (> MAX_PATH),
        // with access_mode(0) to query metadata without hydrating Cloud Files placeholders.
        let handle = OpenOptions::new()
            .access_mode(0)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
            .map_err(|_| FileSafetyError::InvalidPath)?;
        let info = query_handle_tag(handle.as_raw_handle().cast::<c_void>())?;
        if info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            Ok(Some(info.reparse_tag))
        } else {
            Ok(None)
        }
    }

    pub(super) fn check_path_reparse(path: &Path) -> Result<(), FileSafetyError> {
        if let Some(tag) = query_path_reparse_tag(path)?
            && !is_allowed_reparse_tag(tag)
        {
            return Err(FileSafetyError::InvalidPath);
        }
        Ok(())
    }

    pub(super) fn check_file_handle(
        file: &File,
        opened_as_reparse_point: bool,
    ) -> Result<(), FileSafetyError> {
        let info = query_handle_tag(file.as_raw_handle().cast::<c_void>())?;
        if info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            && (opened_as_reparse_point || !is_allowed_reparse_tag(info.reparse_tag))
        {
            return Err(FileSafetyError::InvalidPath);
        }
        Ok(())
    }
}

fn check_node_safety(path: &Path, metadata: &Metadata) -> Result<(), FileSafetyError> {
    if metadata.file_type().is_symlink() {
        return Err(FileSafetyError::InvalidPath);
    }
    #[cfg(windows)]
    if windows_reparse::has_reparse_point(metadata) {
        windows_reparse::check_path_reparse(path)?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

// Inspect every ancestor without following links, rejecting symlinks, mount points,
// and unknown/name-surrogate Windows reparse points while allowing verified non-link
// system data tags (WOF / Cloud Files).
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
                check_node_safety(&current, &metadata)?;
                if current != path && !metadata.is_dir() {
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
    let opened_as_reparse_point = {
        use std::os::windows::fs::OpenOptionsExt;
        // Normal files keep FILE_FLAG_OPEN_REPARSE_POINT to block TOCTOU symlink swaps;
        // verified non-link system files (WOF/Cloud) open normally for transparent reads.
        if !windows_reparse::has_reparse_point(&metadata) {
            options.custom_flags(windows_reparse::FILE_FLAG_OPEN_REPARSE_POINT);
            true
        } else {
            false
        }
    };
    let file = options.open(path).map_err(|_| FileSafetyError::Unavailable)?;
    let metadata = file.metadata().map_err(|_| FileSafetyError::Storage)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(FileSafetyError::InvalidPath);
    }
    #[cfg(windows)]
    windows_reparse::check_file_handle(&file, opened_as_reparse_point)?;
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

    #[cfg(windows)]
    #[test]
    fn reparse_tag_policy_allows_verified_non_link_tags_and_rejects_links_and_unknown_tags() {
        use super::windows_reparse::*;

        assert!(is_allowed_reparse_tag(IO_REPARSE_TAG_WOF));
        for offset in 0..=0xFu32 {
            let cloud_tag = IO_REPARSE_TAG_CLOUD_BASE | (offset << 12);
            assert!(is_allowed_reparse_tag(cloud_tag), "{cloud_tag:#x}");
        }
        for rejected in [
            IO_REPARSE_TAG_SYMLINK,
            IO_REPARSE_TAG_MOUNT_POINT,
            0x2000_0001, // name-surrogate bit set
            0xA000_001D, // AppExecLink (name surrogate)
            0x8000_0000, // unknown non-surrogate
            0x0000_0000,
        ] {
            assert!(!is_allowed_reparse_tag(rejected), "{rejected:#x}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn inspect_queries_real_windows_junction_tag_and_rejects_it() {
        use super::windows_reparse::*;

        let temp = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let junction = temp.path().join("junction");
        let output = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&junction)
            .arg(target.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "mklink /J failed");
        assert_eq!(
            query_path_reparse_tag(&junction).unwrap(),
            Some(IO_REPARSE_TAG_MOUNT_POINT)
        );
        assert_eq!(inspect(&junction).unwrap_err(), FileSafetyError::InvalidPath);
        assert_eq!(
            inspect(&junction.join("nested.txt")).unwrap_err(),
            FileSafetyError::InvalidPath
        );
    }

    #[cfg(windows)]
    #[test]
    fn inspect_and_bounded_read_support_long_windows_paths() {
        use super::windows_reparse::*;

        let temp = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let mut dir = temp.path().to_path_buf();
        while dir.to_string_lossy().len() < 265 {
            dir.push("long-segment-0123456789abcdef");
        }
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("payload.bin");
        std::fs::write(&file, b"long-path-ok").unwrap();
        assert!(file.to_string_lossy().len() > 260);
        assert_eq!(query_path_reparse_tag(&file).unwrap(), None);
        assert!(inspect(&file).unwrap().is_some());
        assert_eq!(bounded_read(&file, 64).unwrap(), b"long-path-ok");

        // Also verify reparse-tag probing on a junction located beyond MAX_PATH.
        let long_junction = dir.join("long-junction");
        let prefixed_junction = format!(r"\\?\{}", long_junction.display());
        let output = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J", &prefixed_junction])
            .arg(target.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "mklink /J on long path failed");
        assert_eq!(
            query_path_reparse_tag(&long_junction).unwrap(),
            Some(IO_REPARSE_TAG_MOUNT_POINT)
        );
        assert_eq!(
            inspect(&long_junction).unwrap_err(),
            FileSafetyError::InvalidPath
        );
    }
}
