/// Returns the PATH environment variable with the sidecar binaries directory prepended.
/// In production, sidecar binaries (yt-dlp.exe, deno.exe) are placed in the same
/// directory as the main executable. Injecting this directory lets yt-dlp discover
/// the bundled deno.exe at runtime without requiring a system-wide Deno installation.
#[tauri::command]
fn get_sidecar_path_env() -> String {
    let sidecar_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().into_owned()))
        .unwrap_or_default();

    let current_path = std::env::var("PATH").unwrap_or_default();
    if sidecar_dir.is_empty() {
        current_path
    } else {
        format!("{};{}", sidecar_dir, current_path)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![get_sidecar_path_env])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
