mod background;
mod tray;
mod drawing;
mod attachments;
mod ayase_backup;
mod cherry_import;
mod cherry_legacy;
mod cherry_leveldb;
mod cherry_sqlite;
mod cherry_v8;
#[cfg(desktop)]
mod instance_lock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // Keep private attachment staging and its DB ownership in one process.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = tray::show_main_window(app);
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
                    .with_filter(|label| label != "tray-menu")
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
            #[cfg(desktop)]
            tray::install(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray::hide_main_window,
            tray::tray_menu_action,
            drawing::save_drawing_result,
            drawing::recover_drawing_result,
            drawing::inspect_drawing_recovery,
            drawing::discard_drawing_recovery,
            drawing::resume_drawing_recovery,
            drawing::read_drawing_result,
            drawing::read_drawing_thumbnail,
            drawing::export_drawing_result,
            drawing::open_drawing_output_directory,
            drawing::output::get_drawing_output_directory_settings,
            drawing::output::select_drawing_output_directory,
            drawing::output::reset_drawing_output_directory,
            drawing::output::prepare_drawing_output,
            drawing::import_drawing_reference,
            drawing::import_drawing_reference_bytes,
            drawing::list_drawing_references,
            drawing::remove_drawing_references,
            background::select_background_image,
            background::resolve_background_image,
            background::cleanup_background_images,
            attachments::persist_attachment,
            attachments::read_sent_attachment,
            attachments::verify_sent_attachments,
            attachments::discard_uncommitted_attachments,
            attachments::cleanup_sent_attachments,
            ayase_backup::select_ayase_backup,
            ayase_backup::save_ayase_backup,
            ayase_backup::read_ayase_resource,
            ayase_backup::write_ayase_resource,
            ayase_backup::remove_ayase_resources,
            ayase_backup::assert_ayase_resources_available,
            ayase_backup::ayase_backup_fence,
            cherry_import::select_cherry_backup,
            cherry_import::read_cherry_file,
            cherry_import::close_cherry_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
