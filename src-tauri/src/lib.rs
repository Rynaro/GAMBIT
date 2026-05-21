pub mod brand;
pub mod watcher;

use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(WatcherState::new())
        .setup(|_app| {
            // v0.0.1: scaffold only.
            // TODO(v0.1): on first launch, extract bundled CLI tarball from resources/ to user-data dir
            //             and verify SHA-256 against cli.pin.toml.
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            watcher::start_watching,
            watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GAMBIT application");
}
