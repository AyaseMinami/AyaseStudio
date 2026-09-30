use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    path::Path,
    sync::Mutex,
};
use tauri_plugin_dialog::DialogExt;
use zip::ZipArchive;

const ARCHIVE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const CHAT_LIMIT: u64 = 128 * 1024 * 1024;
const FILE_LIMIT: u64 = 64 * 1024 * 1024;
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
struct Session {
    token: String,
    archive: ZipArchive<File>,
    indices: BTreeMap<String, usize>,
    files: BTreeMap<String, (String, u64, bool)>,
    read_budget: u64,
}
fn error(_: impl std::fmt::Debug) -> String {
    "cherry-invalid-backup".into()
}
fn safe_path(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 4096
        && !name.starts_with('/')
        && !name.contains(['\\', ':', '\0'])
        && !name.chars().any(|c| c.is_control())
        && name.trim_end_matches('/').split('/').all(|c| {
            let stem = c.split('.').next().unwrap().to_uppercase();
            !c.is_empty()
                && c != "."
                && c != ".."
                && !c.ends_with(['.', ' '])
                && !matches!(
                    stem.as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}
impl Session {
    fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(error)?;
        if file.metadata().map_err(error)?.len() > ARCHIVE_LIMIT {
            return Err("cherry-limit".into());
        }
        let mut archive = ZipArchive::new(file).map_err(error)?;
        if archive.len() > 50000 {
            return Err("cherry-limit".into());
        }
        let mut indices = BTreeMap::new();
        let mut folded = std::collections::BTreeSet::new();
        let mut size = 0u64;
        for index in 0..archive.len() {
            let file = archive.by_index(index).map_err(error)?;
            let name = file.name();
            if !safe_path(name)
                || !folded.insert(name.to_lowercase())
                || file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            {
                return Err("cherry-unsafe-archive".into());
            }
            size = size.checked_add(file.size()).ok_or("cherry-limit")?;
            if size > ARCHIVE_LIMIT || file.size() > ARCHIVE_LIMIT {
                return Err("cherry-limit".into());
            }
            indices.insert(name.to_owned(), index);
        }
        Ok(Self {
            token: uuid::Uuid::new_v4().to_string(),
            archive,
            indices,
            files: BTreeMap::new(),
            read_budget: 0,
        })
    }
    fn bytes(&mut self, key: &str, limit: u64) -> Result<Vec<u8>, String> {
        let index = *self.indices.get(key).ok_or("cherry-missing-entry")?;
        let mut file = self.archive.by_index(index).map_err(error)?;
        if file.size() > limit {
            return Err("cherry-limit".into());
        }
        let mut bytes = Vec::new();
        file.by_ref()
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(error)?;
        if bytes.len() as u64 > limit {
            return Err("cherry-limit".into());
        }
        Ok(bytes)
    }
    fn json(&mut self, key: &str) -> Result<Value, String> {
        serde_json::from_slice(&self.bytes(key, CHAT_LIMIT)?).map_err(error)
    }
    fn preview(&mut self) -> Result<Value, String> {
        let mut app_version = None;
        let (format, source, mut data) = if self.indices.contains_key("metadata.json") {
            let metadata = self.json("metadata.json")?;
            if metadata.get("appName").and_then(Value::as_str) != Some("Cherry Studio") {
                return Err("cherry-unsupported-format".into());
            }
            let format = metadata
                .get("version")
                .and_then(Value::as_u64)
                .ok_or("cherry-unsupported-format")?;
            app_version = metadata
                .get("appVersion")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let temp = tempfile::tempdir().map_err(error)?;
            match format {
                6 if app_version.as_deref() == Some("1.9.13") => {
                    // SQLite in a v6 archive can be a leftover database. Never promote it.
                    let keys: Vec<_> = self
                        .indices
                        .keys()
                        .filter(|k| {
                            (k.starts_with("IndexedDB/") || k.starts_with("Local Storage/leveldb/"))
                                && !k.ends_with('/')
                        })
                        .cloned()
                        .collect();
                    let mut total = 0usize;
                    for key in keys {
                        // Extract only LevelDB control/data files. No app code is executed.
                        let filename = key.rsplit('/').next().unwrap();
                        let numeric =
                            |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
                        let manifest = filename.strip_prefix("MANIFEST-").is_some_and(numeric);
                        let table = filename.rsplit_once('.').is_some_and(|(n, ext)| {
                            numeric(n) && ["log", "ldb", "sst"].contains(&ext)
                        });
                        if !(filename == "CURRENT" || manifest || table) {
                            continue;
                        }
                        let bytes = self.bytes(&key, CHAT_LIMIT)?;
                        total += bytes.len();
                        if total > CHAT_LIMIT as usize {
                            return Err("cherry-limit".into());
                        }
                        let path = temp.path().join(&key);
                        std::fs::create_dir_all(path.parent().unwrap()).map_err(error)?;
                        File::create(&path)
                            .map_err(error)?
                            .write_all(&bytes)
                            .map_err(error)?;
                    }
                    (
                        6,
                        "legacy-chromium",
                        crate::cherry_legacy::read_chromium(temp.path())?,
                    )
                }
                7 if app_version.as_deref() == Some("2.1.3") => {
                    let bytes = self.bytes("Data/cherrystudio.sqlite", CHAT_LIMIT)?;
                    if !bytes.starts_with(b"SQLite format 3\0") {
                        return Err("cherry-invalid-backup".into());
                    }
                    let path = temp.path().join("chat.sqlite");
                    File::create(&path)
                        .map_err(error)?
                        .write_all(&bytes)
                        .map_err(error)?;
                    (7, "sqlite", crate::cherry_sqlite::read_sqlite(&path)?)
                }
                _ => return Err("cherry-unsupported-format".into()),
            }
        } else {
            (
                5,
                "legacy-json",
                crate::cherry_legacy::read_json(&self.json("data.json")?)?,
            )
        };
        if let Some(files) = data.get("files").and_then(Value::as_object) {
            for (key, item) in files {
                if safe_path(key) && key.starts_with("Data/Files/") {
                    self.files.insert(
                        key.clone(),
                        (
                            item.get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned(),
                            item.get("size").and_then(Value::as_u64).unwrap_or(0),
                            item.get("recoverable")
                                .and_then(Value::as_bool)
                                .unwrap_or(true),
                        ),
                    );
                }
            }
        }
        for topic in data["topics"]
            .as_array_mut()
            .ok_or("cherry-invalid-backup")?
        {
            for message in topic["messages"]
                .as_array_mut()
                .ok_or("cherry-invalid-backup")?
            {
                for part in message["parts"]
                    .as_array_mut()
                    .ok_or("cherry-invalid-backup")?
                {
                    if part["type"] == "file" {
                        let key = part["fileKey"].as_str().ok_or("cherry-invalid-file")?;
                        let available = self
                            .indices
                            .get(key)
                            .and_then(|i| self.archive.by_index(*i).ok())
                            .is_some_and(|entry| entry.size() <= FILE_LIMIT)
                            && self.files.get(key).is_some_and(|(name, _, recoverable)| {
                                *recoverable
                                    && crate::attachments::import_mime(name, b"PK\x03\x04")
                                        .is_some()
                            });
                        part["available"] = json!(available)
                    }
                }
            }
        }
        data.as_object_mut()
            .ok_or("cherry-invalid-backup")?
            .remove("files");
        data["token"] = json!(self.token);
        data["format"] = json!(format);
        data["source"] = json!(source);
        if let Some(version) = app_version {
            data["appVersion"] = json!(version)
        }
        // Bound the IPC payload independently of compressed/on-disk sizes.
        if serde_json::to_vec(&data).map_err(error)?.len() > 64 * 1024 * 1024 {
            return Err("cherry-limit".into());
        }
        Ok(data)
    }
    fn file(&mut self, key: &str) -> Result<Option<Value>, String> {
        let (name, expected_size, recoverable) =
            self.files.get(key).ok_or("cherry-invalid-file")?.clone();
        if !recoverable {
            return Ok(None);
        }
        if !self.indices.contains_key(key) {
            return Ok(None);
        }
        let size = self
            .archive
            .by_index(self.indices[key])
            .map_err(error)?
            .size();
        if size > FILE_LIMIT {
            return Ok(None);
        }
        if expected_size != 0 && size != expected_size {
            return Err("cherry-invalid-file".into());
        }
        self.read_budget = self.read_budget.checked_add(size).ok_or("cherry-limit")?;
        if self.read_budget > 1024 * 1024 * 1024 {
            return Err("cherry-limit".into());
        }
        let bytes = self.bytes(key, FILE_LIMIT)?;
        let Some(mime) = crate::attachments::import_mime(&name, &bytes) else {
            return Ok(None);
        };
        Ok(Some(
            json!({"name":name,"mimeType":mime,"size":bytes.len(),"data":STANDARD.encode(bytes)}),
        ))
    }
}
#[tauri::command]
pub async fn select_cherry_backup(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Cherry Studio ZIP", &["zip"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(error)?;
        let mut session = Session::open(&path)?;
        let preview = session.preview()?;
        *SESSION.lock().map_err(error)? = Some(session);
        Ok(Some(preview))
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn read_cherry_file(token: String, key: String) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = SESSION.lock().map_err(error)?;
        let session = guard
            .as_mut()
            .filter(|s| s.token == token)
            .ok_or("cherry-expired-preview")?;
        session.file(&key)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub fn close_cherry_backup(token: String) -> Result<(), String> {
    let mut guard = SESSION.lock().map_err(error)?;
    if guard.as_ref().is_some_and(|s| s.token == token) {
        *guard = None
    }
    Ok(())
}
#[cfg(test)]
#[path = "cherry_fixture_tests.rs"]
mod fixture_tests;
#[cfg(test)]
mod tests {
    use super::*;
    fn zip(entries: Vec<(&str, Vec<u8>)>) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
        for (key, bytes) in entries {
            writer
                .start_file(key, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&bytes).unwrap()
        }
        writer.finish().unwrap();
        file
    }
    fn canonical(mut value: Value) -> Value {
        if let Some(messages) = value["messages"].as_array_mut() {
            for m in messages {
                for p in m["parts"].as_array_mut().unwrap() {
                    p.as_object_mut().unwrap().remove("available");
                }
            }
        }
        value
    }
    #[test]
    fn synthetic_v7_zip_projects_and_reads_internal_file() {
        let database = crate::cherry_sqlite::synthetic_database();
        let key = "Data/Files/11111111-1111-4111-8111-111111111111.txt";
        let zip = zip(vec![
            (
                "metadata.json",
                br#"{"appName":"Cherry Studio","appVersion":"2.1.3","version":7}"#.to_vec(),
            ),
            (
                "Data/cherrystudio.sqlite",
                std::fs::read(database.path()).unwrap(),
            ),
            (key, b"note".to_vec()),
        ]);
        let mut session = Session::open(zip.path()).unwrap();
        let preview = session.preview().unwrap();
        assert!(preview["format"] == 7);
        assert!(preview["topics"].as_array().unwrap().len() == 1);
        assert!(session.file(key).unwrap().is_some());
        assert!(session.file("../secret").is_err());
    }
    #[test]
    fn rejects_traversal_and_duplicate_archive_entries() {
        let unsafe_zip = zip(vec![("../evil.log", vec![0])]);
        assert!(Session::open(unsafe_zip.path()).is_err());
        let dup = zip(vec![("metadata.json", vec![0]), ("METADATA.JSON", vec![0])]);
        assert!(Session::open(dup.path()).is_err());
    }
    #[test]
    fn rejects_reserved_devices() {
        for key in [
            "IndexedDB/x/NUL.log",
            "Local Storage/leveldb/CON.sst",
            "Data/AUX.txt",
        ] {
            assert!(!safe_path(key))
        }
    }
    #[test]
    fn rejects_unknown_container_version_and_corrupt_database() {
        for (version, application, bytes) in [
            (8, "2.1.3", vec![]),
            (7, "2.1.3", b"not sqlite".to_vec()),
            (6, "2.9.0", vec![]),
        ] {
            let metadata = serde_json::to_vec(
                &json!({"appName":"Cherry Studio","version":version,"appVersion":application}),
            )
            .unwrap();
            let zip = zip(vec![
                ("metadata.json", metadata),
                ("Data/cherrystudio.sqlite", bytes),
            ]);
            assert!(Session::open(zip.path()).unwrap().preview().is_err());
        }
    }
    #[test]
    fn office_preview_recognition_uses_signature() {
        assert!(crate::attachments::import_mime("report.docx", b"PK\x03\x04").is_some());
        assert!(crate::attachments::import_mime("unknown.xyz", b"PK\x03\x04").is_none());
    }
    #[test]
    fn external_descriptor_never_reads_matching_archive_entry() {
        let key = "Data/Files/11111111-1111-4111-8111-111111111111.txt";
        let archive = zip(vec![(key, b"note".to_vec())]);
        let mut session = Session::open(archive.path()).unwrap();
        session
            .files
            .insert(key.to_owned(), ("external.txt".to_owned(), 4, false));
        assert!(session.file(key).unwrap().is_none());
        assert_eq!(session.read_budget, 0);
    }
    #[test]
    fn unsafe_paths_reject() {
        for s in [
            "../x",
            "/x",
            "a\\x",
            "Data/a:stream",
            "Data/x/../a",
            "Data/a\0b",
        ] {
            assert!(!safe_path(s))
        }
        assert!(safe_path("Data/Files/abc.png"))
    }
    #[test]
    #[ignore = "explicit local sample paths required, private fields never logged"]
    fn local_backup_preview() {
        let path = std::env::var("AYASE_CHERRY_SAMPLE").unwrap();
        let mut session = Session::open(Path::new(&path)).unwrap();
        let preview = session.preview().unwrap();
        let topics = preview["topics"].as_array().unwrap();
        let messages: usize = topics
            .iter()
            .map(|t| t["messages"].as_array().unwrap().len())
            .sum();
        println!(
            "anonymous preview: topics={}, messages={}",
            topics.len(),
            messages
        );
        assert!(!topics.is_empty());
        assert!(messages > 0);
        if let Ok(path) = std::env::var("AYASE_CHERRY_REFERENCE") {
            let reference = Session::open(Path::new(&path)).unwrap().preview().unwrap();
            let other: BTreeMap<_, _> = reference["topics"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| (t["id"].as_str().unwrap(), t))
                .collect();
            let mut common = 0;
            let mut equal = 0;
            let mut same_messages = 0;
            for topic in topics {
                if let Some(previous) = other.get(topic["id"].as_str().unwrap()) {
                    common += 1;
                    if canonical((*previous).clone()) == canonical(topic.clone()) {
                        equal += 1
                    }
                    let mut before = canonical((*previous).clone());
                    let old: BTreeMap<_, _> = before["messages"]
                        .as_array_mut()
                        .unwrap()
                        .iter()
                        .map(|m| (m["id"].as_str().unwrap(), m))
                        .collect();
                    let current = canonical(topic.clone());
                    for m in current["messages"].as_array().unwrap() {
                        if old
                            .get(m["id"].as_str().unwrap())
                            .is_some_and(|old| *old == m)
                        {
                            same_messages += 1
                        }
                    }
                }
            }
            println!("anonymous comparison: common_topics={common}, equal_topics={equal}, equal_messages={same_messages}");
            assert_eq!(common, topics.len());
            assert_eq!(equal, topics.len());
            assert_eq!(same_messages, messages);
            assert_eq!(other.len(), topics.len());
        }
        let mut present = 0;
        let mut missing = 0;
        let mut readable = 0;
        let mut failures = 0;
        let keys: Vec<_> = session.files.keys().cloned().collect();
        for key in keys {
            if session.indices.contains_key(&key) {
                present += 1;
                match session.file(&key) {
                    Ok(Some(_)) => readable += 1,
                    Ok(None) => (),
                    Err(_) => failures += 1,
                }
            } else {
                missing += 1;
            }
        }
        println!("anonymous attachment availability: present={present}, missing={missing}, readable={readable}, failures={failures}");
        assert!(failures == 0);
    }
}
