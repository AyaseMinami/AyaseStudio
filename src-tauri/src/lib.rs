mod background;
mod attachments;
#[cfg(desktop)]
mod instance_lock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        use tauri::Manager;
        // Keep private attachment staging and its DB ownership in one process.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                let directory = app.path().app_data_dir()?;
                match instance_lock::acquire(&directory) {
                    Ok(lease) => {
                        if !app.manage(lease) {
                            return Err(std::io::Error::other("application data lease state unavailable").into());
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        // The single-instance plugin normally focuses the first
                        // window; this fallback closes its initialization race.
                        std::process::exit(0);
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            #[cfg(desktop)]
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::SIZE
                            | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                    )
                    .build(),
            )?;
            let window = app.config().app.windows.first().ok_or_else(||
                std::io::Error::other("main window configuration missing"))?;
            let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), window)?;
            // Keep a native-frame escape hatch for Windows integration verification.
            #[cfg(windows)]
            let builder = builder.decorations(std::env::var_os("AYASE_NATIVE_TITLEBAR").is_some());
            builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            background::select_background_image,
            background::resolve_background_image,
            background::cleanup_background_images,
            attachments::persist_attachment,
            attachments::read_sent_attachment,
            attachments::verify_sent_attachments,
            attachments::discard_uncommitted_attachments,
            attachments::cleanup_sent_attachments,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
