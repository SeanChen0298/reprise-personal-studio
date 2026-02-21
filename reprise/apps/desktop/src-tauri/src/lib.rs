use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct YtDlpResult {
    pub song_name: Option<String>,
    pub artist: Option<String>,
    pub icon_url: Option<String>,
    pub language_fetched: Option<String>,
    pub lyrics: Option<String>,
    pub error: Option<String>,
}

/// Resolve path to the map_song.py sidecar script.
/// In debug builds: relative to the Cargo manifest dir (src-tauri/).
/// In release builds: from the app's bundled resource directory.
fn resolve_script_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        Ok(std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/sidecars/map_song.py"
        )))
    } else {
        app.path()
            .resource_dir()
            .map(|d| d.join("sidecars/map_song.py"))
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn fetch_youtube_metadata(
    app: tauri::AppHandle,
    url: String,
) -> Result<YtDlpResult, String> {
    let script = resolve_script_path(&app)?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("python3")
            .arg(&script)
            .arg(&url)
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Failed to run yt-dlp script: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Script error: {stderr}"));
    }

    let stdout =
        String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 output: {e}"))?;

    serde_json::from_str::<YtDlpResult>(&stdout).map_err(|e| format!("Parse error: {e}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![fetch_youtube_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
