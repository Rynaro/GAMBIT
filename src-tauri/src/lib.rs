pub mod brand;

#[cfg(target_os = "macos")]
use tauri_plugin_window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Apply NSVisualEffectView .sidebar vibrancy on macOS.
            // On Linux and Windows this block is compiled out entirely —
            // the solid CSS fallback (var(--bg-canvas)) handles those platforms.
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                let window = app
                    .get_webview_window("main")
                    .expect("main window not found");
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
                    .expect("failed to apply vibrancy — requires macOS 10.14+");
            }

            // Non-macOS: no vibrancy; solid fallback is handled in CSS.
            #[cfg(not(target_os = "macos"))]
            let _ = app;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GAMBIT application");
}
