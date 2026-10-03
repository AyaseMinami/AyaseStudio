use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 Ayase Studio", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &exit])?;
    let icon = app.default_window_icon().ok_or_else(|| std::io::Error::other("application icon missing"))?;
    TrayIconBuilder::with_id("ayase-main-tray")
        .icon(icon.clone())
        .tooltip("Ayase Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => { let _ = show_main_window(app); }
            "exit" => {
                // Reveal confirmation and data-loss guards; never bypass frontend settlement.
                if show_main_window(app).is_ok() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("ayase-request-exit", ());
                    }
                }
            }
            "settings" => {
                if show_main_window(app).is_ok() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("ayase-open-settings", ());
                    }
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
                | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }) {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
pub fn hide_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || window.app_handle().tray_by_id("ayase-main-tray").is_none() {
        return Err("后台入口不可用，窗口已保留。".into());
    }
    window.hide().map_err(|_| "无法隐藏窗口，请重试。".into())
}
