pub mod brand;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // v0.0.1: scaffold only.
            // TODO(v0.1): register tauri-plugin-shell, tauri-plugin-fs, tauri-plugin-window-vibrancy.
            // TODO(v0.1): on first launch, extract bundled CLI tarball from resources/ to user-data dir
            //             and verify SHA-256 against cli.pin.toml.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MATERIA application");
}
