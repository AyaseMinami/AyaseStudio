//! Device-local output preference and immutable task-to-directory bindings.
//! Small locators stay in app data so changing the preference never loses history.
use super::*;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preference { version: u8, directory: Option<PathBuf> }

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Location { version: u8, task: String, directory: PathBuf }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings { directory: PathBuf, default_directory: PathBuf, is_default: bool }

fn preference_path(root: &Path) -> PathBuf { root.join("drawing-output.json") }
fn location_path(root: &Path, task: &str) -> Result<PathBuf, Error> {
    uuid(task)?;
    Ok(root.join("drawing-locations").join(format!("{task}.json")))
}

fn valid_path(path: &Path) -> Result<(), Error> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) {
        return Err(Error::OutputConfig);
    }
    Ok(())
}

fn read_preference(root: &Path) -> Result<Preference, Error> {
    let path = preference_path(root);
    if inspect(&path)?.is_none() { return Ok(Preference { version: 1, directory: None }); }
    let value: Preference = serde_json::from_slice(&bounded_read(&path, MANIFEST_LIMIT)?)
        .map_err(|_| Error::OutputConfig)?;
    if value.version != 1 { return Err(Error::OutputConfig); }
    if let Some(directory) = &value.directory { valid_path(directory)?; }
    Ok(value)
}

pub(super) fn location(root: &Path, task: &str) -> Result<Option<PathBuf>, Error> {
    let path = location_path(root, task)?;
    if inspect(&path)?.is_none() { return Ok(None); }
    let value: Location = serde_json::from_slice(&bounded_read(&path, MANIFEST_LIMIT)?)
        .map_err(|_| Error::OutputConfig)?;
    if value.version != 1 || value.task != task { return Err(Error::OutputConfig); }
    valid_path(&value.directory)?;
    Ok(Some(value.directory))
}

pub(super) fn writable(directory: &Path, create: bool) -> Result<(), Error> {
    valid_path(directory)?;
    let metadata = inspect(directory).map_err(|_| Error::OutputUnwritable)?;
    if metadata.is_none() && !create { return Err(Error::OutputUnavailable); }
    if metadata.is_some_and(|value| !value.is_dir()) { return Err(Error::OutputUnwritable); }
    if create { std::fs::create_dir_all(directory).map_err(|_| Error::OutputUnwritable)?; }
    inspect(directory).map_err(|_| Error::OutputUnwritable)?;
    let mut probe = tempfile::Builder::new().prefix(".ayase-write-test-").tempfile_in(directory)
        .map_err(|_| Error::OutputUnwritable)?;
    probe.write_all(b"ayase-output-check").map_err(|_| Error::OutputUnwritable)?;
    probe.as_file().sync_all().map_err(|_| Error::OutputUnwritable)?;
    probe.close().map_err(|_| Error::OutputUnwritable)?;
    Ok(())
}

pub(super) fn default_directory(app: &AppHandle, root: &Path) -> Result<PathBuf, Error> {
    // Isolated probes must never share the ordinary application's output tree.
    if app.config().identifier != "io.github.ayaseminami.ayasestudio" { return Ok(root.join("output")); }
    if cfg!(debug_assertions) {
        Ok(Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or(Error::OutputConfig)?.join("output"))
    } else {
        Ok(std::env::current_exe().map_err(|_| Error::OutputConfig)?.parent().ok_or(Error::OutputConfig)?.join("output"))
    }
}

pub(super) fn settings(root: &Path, default: &Path) -> Result<Settings, Error> {
    let preference = read_preference(root)?;
    Ok(Settings { is_default: preference.directory.is_none(), directory: preference.directory.unwrap_or_else(|| default.to_owned()), default_directory: default.to_owned() })
}

pub(super) fn configured_directory(root: &Path, default: &Path) -> Result<PathBuf, Error> {
    let preference = read_preference(root)?;
    let directory = preference.directory.as_deref().unwrap_or(default);
    writable(directory, preference.directory.is_none())?;
    Ok(directory.to_owned())
}

fn persist_preference(root: &Path, value: &Preference) -> Result<(), Error> {
    let destination = preference_path(root);
    inspect(&destination)?;
    inspect(root)?;
    std::fs::create_dir_all(root).map_err(|_| Error::OutputConfig)?;
    let bytes = serde_json::to_vec(value).map_err(|_| Error::OutputConfig)?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|_| Error::OutputConfig)?;
    file.write_all(&bytes).map_err(|_| Error::OutputConfig)?;
    file.as_file().sync_all().map_err(|_| Error::OutputConfig)?;
    file.persist(&destination).map_err(|_| Error::OutputConfig)?;
    Ok(())
}

pub(super) fn select(root: &Path, default: &Path, chosen: Option<PathBuf>) -> Result<Settings, Error> {
    read_preference(root)?; // Unknown/corrupt configuration never authorizes overwrite.
    let directory = chosen.as_deref().unwrap_or(default);
    writable(directory, chosen.is_none())?;
    writable(&directory.join("meta"), true)?;
    persist_preference(root, &Preference { version: 1, directory: chosen })?;
    settings(root, default)
}

pub(super) fn reserve(root: &Path, default: &Path, tasks: &[String]) -> Result<(), Error> {
    if tasks.is_empty() || tasks.len() > 99 { return Err(Error::InvalidParameters); }
    let mut unique = HashSet::new();
    for task in tasks { uuid(task)?; if !unique.insert(task) { return Err(Error::InvalidParameters); } }
    let preference = read_preference(root)?;
    let selected = preference.directory.as_deref().unwrap_or(default);
    let mut bindings = Vec::new();
    for task in tasks {
        uuid(task)?;
        if let Some(directory) = location(root, task)? {
            writable(&directory, false)?;
            writable(&directory.join("meta"), true)?;
            writable(&directory.join("meta").join(task), true)?;
        } else if inspect(&root.join("drawing").join(task))?.is_some()
            || inspect(&root.join("drawing").join("meta").join(task))?.is_some() {
            // Existing v1/v2 task data is pinned to app data forever.
            writable(&root.join("drawing"), false)?;
            writable(&task_directory(root, task)?, false)?;
        } else {
            bindings.push(task);
        }
    }
    if bindings.is_empty() { return Ok(()); }
    writable(selected, preference.directory.is_none())?;
    writable(&selected.join("meta"), true)?;
    let directory = root.join("drawing-locations");
    inspect(&directory)?;
    std::fs::create_dir_all(&directory).map_err(|_| Error::OutputConfig)?;
    for task in bindings {
        let value = Location { version: 1, task: task.clone(), directory: selected.to_owned() };
        publish(&location_path(root, task)?, &serde_json::to_vec(&value).map_err(|_| Error::OutputConfig)?)?;
        writable(&selected.join("meta").join(task), true)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixels() -> DrawingImageInput {
        let mut data = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(2, 2).write_to(&mut data, ImageFormat::Png).unwrap();
        DrawingImageInput { mime: "image/png".into(), data: STANDARD.encode(data.into_inner()) }
    }

    #[test]
    fn selection_reset_restart_and_write_probe_leave_no_extra_files() {
        let app = tempfile::tempdir().unwrap();
        let selected = tempfile::tempdir().unwrap();
        let default = app.path().join("default-output");
        let initial = settings(app.path(), &default).unwrap();
        assert!(initial.is_default);
        assert_eq!(initial.directory, default);
        assert!(!preference_path(app.path()).exists());
        assert!(!default.exists());
        let result = select(app.path(), &default, Some(selected.path().to_owned())).unwrap();
        assert!(!result.is_default);
        assert_eq!(settings(app.path(), &default).unwrap().directory, selected.path());
        assert_eq!(std::fs::read_dir(selected.path()).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(selected.path().join("meta")).unwrap().count(), 0);
        assert!(select(app.path(), &default, None).unwrap().is_default);
        assert_eq!(std::fs::read_dir(&default).unwrap().count(), 1);
    }

    #[test]
    fn directory_change_keeps_batch_locations_and_read_export_recovery_delete_work() {
        let app = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let task_a = Uuid::new_v4().to_string();
        let task_b = Uuid::new_v4().to_string();
        reserve(app.path(), a.path(), std::slice::from_ref(&task_a)).unwrap();
        select(app.path(), a.path(), Some(b.path().to_owned())).unwrap();
        let images = [pixels()];
        let first = save(app.path(), &task_a, &images).unwrap();
        assert_eq!(result_path(app.path(), &first[0].reference).unwrap().parent().unwrap(), a.path());
        reserve(app.path(), a.path(), std::slice::from_ref(&task_b)).unwrap();
        let second = save(app.path(), &task_b, &images).unwrap();
        assert_eq!(result_path(app.path(), &second[0].reference).unwrap().parent().unwrap(), b.path());
        assert_eq!(read(app.path(), &first[0].reference).unwrap().data, images[0].data);
        assert!(thumbnail(app.path(), &first[0].reference).is_ok());
        assert_eq!(recover(app.path(), &task_a).unwrap(), Some(first.clone()));
        assert_eq!(save(app.path(), &task_a, &images).unwrap(), first);
        let outside = tempfile::tempdir().unwrap();
        export_png(app.path(), &first[0].reference, &outside.path().join("export.png")).unwrap();
        assert!(export_png(app.path(), &first[0].reference, &result_path(app.path(), &second[0].reference).unwrap()).is_err());
        assert!(export_png(app.path(), &first[0].reference, &b.path().join("meta/overwrite.png")).is_err());
        discard_completed(app.path(), &task_a).unwrap();
        assert!(read(app.path(), &second[0].reference).is_ok());
        assert!(location(app.path(), &task_a).unwrap().is_some());
    }

    #[test]
    fn unavailable_and_non_directory_targets_preserve_settings_and_never_fallback() {
        let app = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let default = app.path().join("default-output");
        select(app.path(), &default, Some(output.path().to_owned())).unwrap();
        let before = std::fs::read(preference_path(app.path())).unwrap();
        let bad = app.path().join("not-a-directory");
        std::fs::write(&bad, b"preserve").unwrap();
        assert!(matches!(select(app.path(), &default, Some(bad)), Err(Error::OutputUnwritable)));
        let task = Uuid::new_v4().to_string();
        reserve(app.path(), &default, std::slice::from_ref(&task)).unwrap();
        output.close().unwrap();
        assert_eq!(reserve(app.path(), &default, std::slice::from_ref(&task)), Err(Error::OutputUnavailable));
        assert_eq!(std::fs::read(preference_path(app.path())).unwrap(), before);
        assert!(!default.exists());
        assert!(!app.path().join("drawing").exists());
    }

    #[test]
    fn future_or_corrupt_config_and_locations_refuse_writes_and_preserve_bytes() {
        let app = tempfile::tempdir().unwrap();
        let default = app.path().join("output");
        for content in [r#"{"version":2,"directory":null}"#, r#"{"version":1,"directory":null,"extra":true}"#, "not-json"] {
            std::fs::write(preference_path(app.path()), content).unwrap();
            assert!(settings(app.path(), &default).is_err());
            assert!(select(app.path(), &default, None).is_err());
            assert!(reserve(app.path(), &default, &[Uuid::new_v4().to_string()]).is_err());
            assert_eq!(std::fs::read_to_string(preference_path(app.path())).unwrap(), content);
            assert!(!default.exists());
        }
        std::fs::remove_file(preference_path(app.path())).unwrap();
        let task = Uuid::new_v4().to_string();
        let path = location_path(app.path(), &task).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"corrupt").unwrap();
        assert!(reserve(app.path(), &default, std::slice::from_ref(&task)).is_err());
        assert!(save(app.path(), &task, &[pixels()]).is_err());
        assert!(discard_recovery(app.path(), &task).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"corrupt");
        assert!(!default.exists());
    }

    #[test]
    fn old_task_locations_remain_in_appdata_and_metadata_collision_blocks_new_batch() {
        let app = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let old = Uuid::new_v4().to_string();
        let files = save(app.path(), &old, &[pixels()]).unwrap();
        reserve(app.path(), output.path(), std::slice::from_ref(&old)).unwrap();
        assert!(location(app.path(), &old).unwrap().is_none());
        assert!(read(app.path(), &files[0].reference).is_ok());
        std::fs::write(output.path().join("meta"), b"keep").unwrap();
        let new = Uuid::new_v4().to_string();
        assert!(reserve(app.path(), output.path(), std::slice::from_ref(&new)).is_err());
        assert!(!location_path(app.path(), &new).unwrap().exists());
    }

    #[test]
    fn queued_binding_rechecks_metadata_writability_before_dispatch() {
        let app = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let task = Uuid::new_v4().to_string();
        reserve(app.path(), output.path(), std::slice::from_ref(&task)).unwrap();
        let metadata = output.path().join("meta").join(&task);
        std::fs::remove_dir(&metadata).unwrap();
        std::fs::write(&metadata, b"collision").unwrap();
        assert_eq!(reserve(app.path(), output.path(), std::slice::from_ref(&task)), Err(Error::OutputUnwritable));
        assert_eq!(std::fs::read(&metadata).unwrap(), b"collision");
    }

    #[test]
    fn canonical_destination_cannot_bypass_registered_output_protection() {
        let app = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        reserve(app.path(), output.path(), &[Uuid::new_v4().to_string()]).unwrap();
        let canonical = output.path().canonicalize().unwrap();
        assert_eq!(protect_export(app.path(), &canonical.join("existing.png")), Err(Error::InvalidReference));
        std::fs::write(app.path().join("drawing-locations/.tmp-crash"), b"partial").unwrap();
        let other = tempfile::tempdir().unwrap();
        assert!(protect_export(app.path(), &other.path().join("export.png")).is_ok());
    }
}

pub(super) fn protect_export(root: &Path, destination: &Path) -> Result<(), Error> {
    let directory = root.join("drawing-locations");
    if inspect(&directory)?.is_none() { return Ok(()); }
    let target_parent = destination.parent().ok_or(Error::InvalidReference)?
        .canonicalize().map_err(|_| Error::Storage)?;
    let destination = target_parent.join(destination.file_name().ok_or(Error::InvalidReference)?);
    for entry in std::fs::read_dir(&directory).map_err(|_| Error::Storage)? {
        let path = entry.map_err(|_| Error::Storage)?.path();
        // An interrupted NamedTempFile publication can leave .tmp* files.
        // They never owned resources and must not poison unrelated exports.
        if path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(".tmp")) { continue; }
        let task = path.file_stem().and_then(|name| name.to_str()).ok_or(Error::OutputConfig)?;
        let output = location(root, task)?.ok_or(Error::OutputConfig)?;
        // A nonexistent output cannot contain this already-existing destination parent.
        // Existing roots and the destination use the same canonical representation,
        // including UNC prefixes and Windows short-name aliases.
        if inspect(&output)?.is_none() { continue; }
        let output = output.canonicalize().map_err(|_| Error::Storage)?;
        // Windows path components are case insensitive even though Path::starts_with is not.
        let target = destination.to_string_lossy().replace('/', "\\").to_lowercase();
        let prefix = output.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
        if target == prefix || target.starts_with(&format!("{prefix}\\")) { return Err(Error::InvalidReference); }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_drawing_output_directory_settings(app: AppHandle) -> Result<Settings, String> {
    let root = app_directory(&app)?;
    let default = default_directory(&app, &root).map_err(|e| e.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        settings(&root, &default).map_err(|e| e.code())
    }).await.map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn select_drawing_output_directory(app: AppHandle) -> Result<Option<Settings>, String> {
    let root = app_directory(&app)?;
    let default = default_directory(&app, &root).map_err(|e| e.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app.dialog().file().blocking_pick_folder() else { return Ok(None); };
        let selected = folder.into_path().map_err(|_| Error::OutputConfig.code())?;
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        select(&root, &default, Some(selected)).map(Some).map_err(|e| e.code())
    }).await.map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn reset_drawing_output_directory(app: AppHandle) -> Result<Settings, String> {
    let root = app_directory(&app)?;
    let default = default_directory(&app, &root).map_err(|e| e.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        select(&root, &default, None).map_err(|e| e.code())
    }).await.map_err(|_| Error::Storage.code())?
}

#[tauri::command]
pub async fn prepare_drawing_output(app: AppHandle, task_ids: Vec<String>) -> Result<(), String> {
    let root = app_directory(&app)?;
    let default = default_directory(&app, &root).map_err(|e| e.code())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DRAWING_FILES.lock().map_err(|_| Error::Storage.code())?;
        reserve(&root, &default, &task_ids).map_err(|e| e.code())
    }).await.map_err(|_| Error::Storage.code())?
}
