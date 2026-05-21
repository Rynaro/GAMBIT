pub mod binary;
pub mod brand;
pub mod doctor;
pub mod extract;
pub mod mcp;
pub mod sync;
pub mod upgrade;
pub mod watcher;

use doctor::DoctorState;
use mcp::McpStoreState;
use sync::SyncState;
use upgrade::UpgradeState;
use watcher::WatcherState;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

// binary_status command lives in binary.rs (see binary::binary_status).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(WatcherState::new())
        .manage(SyncState::new())
        .manage(DoctorState::new())
        .manage(UpgradeState::new())
        .manage(McpStoreState::new())
        .setup(|app| {
            // Extract the bundled eidolons CLI tarball on first launch (idempotent).
            // If no tarball is bundled (dev mode) this is a silent no-op.
            // On failure it logs a warning and proceeds — PATH / nexus fallback runs.
            if let Err(e) = extract::extract_bundled_cli_if_present(&app.handle()) {
                eprintln!("[bundled-cli] extraction warn: {e}");
            }

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
        .invoke_handler(tauri::generate_handler![
            watcher::start_watching,
            watcher::stop_watching,
            sync::start_sync,
            sync::cancel_sync,
            doctor::start_doctor,
            doctor::cancel_doctor,
            upgrade::check_upgrades,
            upgrade::start_upgrade_apply,
            upgrade::start_nexus_upgrade,
            upgrade::cancel_upgrade,
            mcp::mcp_list,
            mcp::mcp_install,
            mcp::mcp_uninstall,
            mcp::mcp_cancel,
            binary::binary_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GAMBIT application");
}
