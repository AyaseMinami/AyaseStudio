use std::{fs::{File, OpenOptions, TryLockError}, io, path::Path};

/// Held for the full desktop process lifetime: another process must not sweep
/// this instance's uncommitted private attachment staging directory.
pub fn acquire(app_data: &Path) -> io::Result<File> {
    let dir = app_data.join("attachments");
    std::fs::create_dir_all(&dir)?;
    // Never remove this empty file: replacing a locked inode would defeat the lock.
    let file = OpenOptions::new().read(true).write(true).create(true)
        .open(dir.join(".instance.lock"))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => Err(io::Error::new(io::ErrorKind::WouldBlock,
            "Ayase Studio is already using this application data directory")),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_handle_cannot_enter_until_the_first_process_lease_is_released() {
        let temp = tempfile::tempdir().unwrap();
        let first = acquire(temp.path()).unwrap();
        assert_eq!(acquire(temp.path()).unwrap_err().kind(), io::ErrorKind::WouldBlock);
        drop(first);
        assert!(acquire(temp.path()).is_ok());
    }
}
