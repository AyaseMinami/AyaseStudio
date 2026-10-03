use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const MENU_LABEL: &str = "tray-menu";
const MENU_WIDTH: f64 = 240.0;
const MENU_HEIGHT: f64 = 147.0;

#[derive(Default)]
struct MenuReady(AtomicBool);

fn dispatch_action(app: &tauri::AppHandle, action: &str) -> tauri::Result<()> {
    show_main_window(app)?;
    if let Some(window) = app.get_webview_window("main") {
        match action {
            "settings" => window.emit("ayase-open-settings", ())?,
            "exit" => window.emit("ayase-request-exit", ())?,
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tray_menu_action(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    if window.label() != MENU_LABEL {
        return Err("菜单入口不可用".into());
    }
    match action.as_str() {
        "ready" => {
            window.state::<MenuReady>().0.store(true, Ordering::Release);
            Ok(())
        }
        "dismiss" => window.hide().map_err(|_| "无法收起菜单".into()),
        "open" | "settings" | "exit" => {
            dispatch_action(window.app_handle(), &action).map_err(|_| "操作未完成，请重试".to_string())?;
            window.hide().map_err(|_| "无法收起菜单".into())
        }
        _ => Err("未知菜单操作".into()),
    }
}

// Coordinates and work area are physical pixels, including negative monitor origins.
fn menu_origin(point: (f64, f64), area: (i32, i32, u32, u32), size: (f64, f64)) -> (i32, i32) {
    let (left, top, width, height) = area;
    let x = (point.0 - size.0).clamp(left as f64, (left as f64 + width as f64 - size.0).max(left as f64));
    let y = (point.1 - size.1).clamp(top as f64, (top as f64 + height as f64 - size.1).max(top as f64));
    (x.round() as i32, y.round() as i32)
}

fn show_menu(app: &tauri::AppHandle, point: tauri::PhysicalPosition<f64>) -> tauri::Result<bool> {
    if !app.state::<MenuReady>().0.load(Ordering::Acquire) { return Ok(false); }
    let Some(window) = app.get_webview_window(MENU_LABEL) else { return Ok(false); };
    let Some(monitor) = app.monitor_from_point(point.x, point.y)? else { return Ok(false); };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let size = (MENU_WIDTH * scale, MENU_HEIGHT * scale);
    let (x, y) = menu_origin((point.x, point.y),
        (area.position.x, area.position.y, area.size.width, area.size.height), size);
    window.set_position(tauri::PhysicalPosition::new(x, y))?;
    window.set_size(tauri::PhysicalSize::new(size.0.round() as u32, size.1.round() as u32))?;
    window.show()?;
    window.set_focus()?;
    Ok(true)
}

fn install_menu_window(app: &tauri::App) -> tauri::Result<()> {
    let window = tauri::WebviewWindowBuilder::new(app, MENU_LABEL, tauri::WebviewUrl::App("tray.html".into()))
        .title("Ayase Studio 菜单")
        .inner_size(MENU_WIDTH, MENU_HEIGHT)
        .decorations(false).transparent(true).shadow(false)
        .resizable(false).maximizable(false).minimizable(false)
        .skip_taskbar(true).always_on_top(true).visible(false).focused(false)
        .on_navigation(|url| url.path() == "/tray.html"
            && matches!(url.host_str(), Some("localhost" | "tauri.localhost" | "127.0.0.1")))
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                window.state::<MenuReady>().0.store(false, Ordering::Release);
            }
        })
        .build()?;
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(false) => { let _ = handle.hide(); }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = handle.hide();
        }
        _ => {}
    });
    Ok(())
}

pub fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    app.manage(MenuReady::default());
    if let Some(main) = app.get_webview_window("main") {
        let handle = app.handle().clone();
        main.on_window_event(move |event| {
            // The main lifecycle destroys its window only after all exit guards accept.
            // A hidden menu WebView must not keep that accepted exit alive.
            if matches!(event, tauri::WindowEvent::Destroyed) { handle.exit(0); }
        });
    }
    // A failed/unready custom renderer retains the native menu as a recovery path.
    let _ = install_menu_window(app);
    let open = MenuItem::with_id(app, "open", "打开 Ayase Studio", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &exit])?;
    let icon = app.default_window_icon().ok_or_else(|| std::io::Error::other("application icon missing"))?;
    TrayIconBuilder::with_id("ayase-main-tray")
        .icon(icon.clone())
        .tooltip("Ayase Studio")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if matches!(event.id.as_ref(), "open" | "settings" | "exit") {
                let _ = dispatch_action(app, event.id.as_ref());
            }
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Up, position, .. } = event {
                if !matches!(show_menu(tray.app_handle(), position), Ok(true)) {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.popup_menu(&menu);
                    }
                }
            }
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
                | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }) {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::menu_origin;

    #[test]
    fn clamps_to_work_area_on_all_edges() {
        let area = (0, 0, 1920, 1040);
        assert_eq!(menu_origin((1900.0, 1060.0), area, (240.0, 166.0)), (1660, 874));
        assert_eq!(menu_origin((5.0, 10.0), area, (240.0, 166.0)), (0, 0));
        assert_eq!(menu_origin((2100.0, 500.0), area, (240.0, 166.0)), (1680, 334));
    }

    #[test]
    fn supports_negative_origins_scaled_menus_and_small_work_areas() {
        assert_eq!(menu_origin((-10.0, 1300.0), (-2560, -100, 2560, 1400), (480.0, 332.0)), (-490, 968));
        assert_eq!(menu_origin((30.0, 50.0), (0, 0, 120, 100), (240.0, 166.0)), (0, 0));
    }
}

#[tauri::command]
pub fn hide_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || window.app_handle().tray_by_id("ayase-main-tray").is_none() {
        return Err("后台入口不可用，窗口已保留。".into());
    }
    window.hide().map_err(|_| "无法隐藏窗口，请重试。".into())
}
