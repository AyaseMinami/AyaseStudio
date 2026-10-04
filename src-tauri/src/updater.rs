use std::{sync::Mutex, time::Duration};
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::watch;
use semver::Version;

const ROOT: &str = "https://raw.githubusercontent.com/AyaseMinami/AyaseStudio/updates";
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
const CANCELLED: &str = "更新下载已取消";

#[derive(Default)]
pub struct UpdateState(Mutex<SessionState>);
#[derive(Default)]
struct SessionState { checking: bool, session: Option<Session> }
struct Session { id: String, update: Update, bytes: Option<Vec<u8>>, cancel: Option<watch::Sender<bool>>, installing: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo { enabled: bool, current_version: String, channel: &'static str }
#[derive(Serialize)]
pub struct AvailableUpdate { session: String, version: String, notes: String, date: Option<String> }
#[derive(Clone, Serialize)]
pub struct Progress { downloaded: u64, total: Option<u64> }

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("更新仅允许从主窗口操作".into()) }
}
fn channel(version: &Version) -> &'static str { if version.pre.is_empty() { "stable" } else { "beta" } }
fn public_key(app: &AppHandle) -> String {
    app.config().plugins.0.get("updater").and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str()).unwrap_or("").to_owned()
}
fn enabled(app: &AppHandle) -> bool {
    cfg!(all(windows, target_arch = "x86_64")) && crate::update_signature::validate_public_key(&public_key(app)).is_ok()
}
fn validate_release(current: &Version, version: &str, url: &str) -> Result<(), String> {
    let next = Version::parse(version).map_err(|_| "更新版本格式无效")?;
    let pre = next.pre.as_str();
    let valid_beta = pre.strip_prefix("beta.").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    if next <= *current || !next.build.is_empty() || (!pre.is_empty() && (!valid_beta || current.pre.is_empty())) {
        return Err("更新版本不属于当前渠道".into());
    }
    // Manifest cannot redirect the installer to another host/repository/version.
    let expected = format!("https://github.com/AyaseMinami/AyaseStudio/releases/download/v{version}/Ayase.Studio_{version}_x64-setup.exe");
    if url != expected {
        return Err("更新包地址无效".into());
    }
    Ok(())
}

#[tauri::command]
pub fn update_status(app: AppHandle, window: WebviewWindow) -> Result<UpdateInfo, String> {
    main_window(&window)?;
    Ok(UpdateInfo { enabled: enabled(&app), current_version: app.package_info().version.to_string(), channel: channel(&app.package_info().version) })
}

#[tauri::command]
pub async fn update_check(app: AppHandle, window: WebviewWindow, state: State<'_, UpdateState>) -> Result<Option<AvailableUpdate>, String> {
    main_window(&window)?;
    if !enabled(&app) { return Err("此构建未配置应用内更新，请使用官方下载入口".into()); }
    {
        let mut state = state.0.lock().map_err(|_| "更新状态不可用")?;
        if state.checking || state.session.as_ref().is_some_and(|s| s.cancel.is_some() || s.installing) { return Err("更新操作正在进行".into()); }
        state.checking = true;
        state.session = None;
    }
    let result = async {
        let current = &app.package_info().version;
        let endpoint = format!("{ROOT}/{}.json", channel(current)).parse().map_err(|_| "更新地址无效")?;
        let updater = app.updater_builder().endpoints(vec![endpoint]).map_err(|_| "更新配置无效")?
            .timeout(Duration::from_secs(20)).build().map_err(|_| "更新配置无效")?;
        let update = updater.check().await.map_err(|_| "无法检查更新，请检查网络或稍后重试")?;
        if let Some(mut update) = update {
            validate_release(current, &update.version, update.download_url.as_str())?;
            update.timeout = Some(Duration::from_secs(300));
            let id = uuid::Uuid::new_v4().to_string();
            let info = AvailableUpdate { session: id.clone(), version: update.version.clone(), notes: update.body.clone().unwrap_or_default(), date: update.date.map(|d| d.to_string()) };
            Ok(Some((info, Session { id, update, bytes: None, cancel: None, installing: false })))
        } else { Ok(None) }
    }.await;
    let mut state = state.0.lock().map_err(|_| "更新状态不可用")?;
    state.checking = false;
    match result {
        Ok(Some((info, session))) => { state.session = Some(session); Ok(Some(info)) },
        Ok(None) => Ok(None), Err(error) => Err(error),
    }
}

async fn cancellable<T>(mut cancel: watch::Receiver<bool>, work: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    if *cancel.borrow() { return Err(CANCELLED.into()); }
    tokio::select! { biased;
        _ = cancel.changed() => Err(CANCELLED.into()),
        result = work => result,
    }
}

#[tauri::command]
pub async fn update_download(app: AppHandle, window: WebviewWindow, state: State<'_, UpdateState>, session: String, progress: Channel<Progress>) -> Result<(), String> {
    main_window(&window)?;
    let (update, sender, receiver) = {
        let mut state = state.0.lock().map_err(|_| "更新状态不可用")?;
        let slot = state.session.as_mut().filter(|s| s.id == session).ok_or("更新已失效，请重新检查")?;
        if slot.cancel.is_some() || slot.bytes.is_some() || slot.installing { return Err("更新操作正在进行".into()); }
        let (sender, receiver) = watch::channel(false);
        slot.cancel = Some(sender.clone());
        (slot.update.clone(), sender, receiver)
    };
    let mut downloaded = 0u64;
    let result = cancellable(receiver, async {
        update.download(|chunk, total| {
            downloaded = downloaded.saturating_add(chunk as u64);
            if downloaded > MAX_DOWNLOAD || total.is_some_and(|n| n > MAX_DOWNLOAD) || progress.send(Progress { downloaded, total }).is_err() {
                let _ = sender.send(true);
            }
        }, || {}).await.map_err(|_| "更新下载或签名校验失败，请重新检查更新后重试".to_string())
    }).await;
    let mut state = state.0.lock().map_err(|_| "更新状态不可用")?;
    let slot = state.session.as_mut().filter(|s| s.id == session).ok_or(CANCELLED)?;
    let cancelled = slot.cancel.as_ref().is_some_and(|s| *s.borrow());
    slot.cancel = None;
    match result {
        Ok(bytes) if !cancelled => {
            if let Err(error) = crate::update_signature::verify_release(&bytes, &public_key(&app), &slot.update.signature, &slot.update.version) {
                state.session = None; return Err(error);
            }
            slot.bytes = Some(bytes); Ok(())
        },
        Ok(_) => { state.session = None; Err(CANCELLED.into()) },
        Err(error) => { state.session = None; Err(error) },
    }
}

#[tauri::command]
pub fn update_cancel(window: WebviewWindow, state: State<'_, UpdateState>, session: String) -> Result<(), String> {
    main_window(&window)?;
    let mut state = state.0.lock().map_err(|_| "更新状态不可用")?;
    if let Some(slot) = state.session.as_ref().filter(|s| s.id == session) {
        if slot.installing { return Err("安装已经开始，无法取消".into()); }
        if let Some(cancel) = &slot.cancel { let _ = cancel.send(true); } else { state.session = None; }
    }
    Ok(())
}

#[tauri::command]
pub async fn update_install(app: AppHandle, window: WebviewWindow, state: State<'_, UpdateState>, session: String) -> Result<(), String> {
    main_window(&window)?;
    let (update, bytes) = {
        let mut state = state.0.lock().map_err(|_| "更新状态不可用")?;
        let slot = state.session.as_mut().filter(|s| s.id == session).ok_or("更新已失效，请重新检查")?;
        if slot.installing || slot.cancel.is_some() { return Err("更新操作正在进行".into()); }
        let bytes = slot.bytes.take().ok_or("请先下载并验证更新包")?;
        crate::update_signature::verify_release(&bytes, &public_key(&app), &slot.update.signature, &slot.update.version)?;
        slot.installing = true;
        (slot.update.clone(), bytes)
    };
    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    // Successful Windows install exits the process. An error always invalidates the retained package.
    state.0.lock().map_err(|_| "更新状态不可用")?.session = None;
    result.map_err(|_| "更新安装失败，请重新检查更新或手动安装")?
        .map_err(|_| "更新安装失败，请重新检查更新或手动安装".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separates_channels_and_rejects_other_packages_and_downgrades() {
        let beta = Version::parse("0.1.0-beta.3").unwrap();
        let stable = Version::parse("0.1.0").unwrap();
        assert_eq!(channel(&beta), "beta"); assert_eq!(channel(&stable), "stable");
        let url = |v: &str| format!("https://github.com/AyaseMinami/AyaseStudio/releases/download/v{v}/Ayase.Studio_{v}_x64-setup.exe");
        assert!(validate_release(&beta, "0.1.0-beta.4", &url("0.1.0-beta.4")).is_ok());
        assert!(validate_release(&beta, "0.1.0", &url("0.1.0")).is_ok());
        for v in ["0.1.0-beta.2", "0.1.0-alpha.4", "0.1.0-beta.4+build", "bad"] { assert!(validate_release(&beta, v, &url(v)).is_err()); }
        assert!(validate_release(&stable, "0.2.0-beta.1", &url("0.2.0-beta.1")).is_err());
        assert!(validate_release(&beta, "0.1.0-beta.4", &url("0.1.0-beta.3")).is_err());
        assert!(validate_release(&beta, "0.1.0-beta.4", "https://example.com/app.exe").is_err());
        assert!(validate_release(&beta, "0.1.0-beta.4", &(url("0.1.0-beta.4") + "?redirect=1")).is_err());
    }
    #[test]
    fn cancellation_drops_inflight_work_and_already_cancelled_work_never_starts() {
        tauri::async_runtime::block_on(async {
            let (sender, receiver) = watch::channel(false);
            sender.send(true).unwrap();
            assert_eq!(cancellable(receiver, async { panic!("cancelled work was polled"); #[allow(unreachable_code)] Ok(()) }).await.unwrap_err(), CANCELLED);
            let (sender, receiver) = watch::channel(false);
            let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            struct DropFlag(std::sync::Arc<std::sync::atomic::AtomicBool>);
            impl Drop for DropFlag { fn drop(&mut self) { self.0.store(true, std::sync::atomic::Ordering::SeqCst); } }
            let flag = dropped.clone();
            let (started, ready) = tokio::sync::oneshot::channel();
            let work = async move {
                let _guard = DropFlag(flag);
                started.send(()).unwrap();
                std::future::pending::<Result<(), String>>().await
            };
            let (result, ()) = tokio::join!(cancellable(receiver, work), async {
                ready.await.unwrap(); // Cancel only after the download future has actually started.
                sender.send(true).unwrap();
            });
            assert_eq!(result.unwrap_err(), CANCELLED);
            assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        });
    }
}
