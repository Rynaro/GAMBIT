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

// ---------------------------------------------------------------------------
// binary_status IPC command
// ---------------------------------------------------------------------------

use serde::Serialize;

/// Snapshot of all three binary discovery levels.
///
/// Returned by the `binary_status` Tauri command and consumed by the
/// Settings route's "CLI Binary" panel.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    /// The path that `find_eidolons` would resolve to (first winning level).
    pub resolved_path: Option<String>,
    /// True when the bundled-extracted binary exists at <app_data_dir>/cli/eidolons.
    pub bundled_extracted: bool,
    /// Path of the bundled-extraction slot (exists or not).
    pub bundled_path: Option<String>,
    /// Path found via PATH lookup, if present.
    pub path_lookup: Option<String>,
    /// True when ~/.eidolons/nexus/cli/eidolons exists.
    pub nexus_fallback_exists: bool,
    /// The conventional nexus fallback path.
    pub nexus_fallback_path: Option<String>,
}

/// Tauri command: probe all three binary discovery levels and return a status snapshot.
///
/// Called by SettingsRoute on mount to render the "CLI Binary" panel.
/// Does not spawn any process — pure filesystem checks.
#[tauri::command]
pub fn binary_status(app: tauri::AppHandle) -> BinaryStatus {
    let probe = binary::probe_all(&app);
    let resolved_path = binary::find_eidolons(&app)
        .ok()
        .map(|p| p.to_string_lossy().into_owned());

    BinaryStatus {
        resolved_path,
        bundled_extracted: probe.bundled_extracted,
        bundled_path: probe
            .bundled_path
            .map(|p| p.to_string_lossy().into_owned()),
        path_lookup: probe
            .path_lookup
            .map(|p| p.to_string_lossy().into_owned()),
        nexus_fallback_exists: probe.nexus_fallback_exists,
        nexus_fallback_path: probe
            .nexus_fallback_path
            .map(|p| p.to_string_lossy().into_owned()),
    }
}

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
            binary_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GAMBIT application");
}
