/// Starts a one-shot HTTP listener on a random loopback port for the Google Drive OAuth2
/// PKCE callback. Returns the port number to JS so it can construct the redirect_uri.
///
/// The server waits for exactly one GET request to any path with `?code=...`, responds
/// with a plain "you can close this tab" page, then emits a `drive-oauth-code` Tauri
/// event (or `drive-oauth-error` on failure) and shuts down.
#[tauri::command]
fn start_drive_oauth_listener(app: tauri::AppHandle) -> Result<u16, String> {
    use std::net::TcpListener;
    use tauri::Emitter;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    std::thread::spawn(move || {
        let server = match tiny_http::Server::from_listener(listener, None) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit("drive-oauth-error", e.to_string());
                return;
            }
        };

        // Wait for exactly one request (the OAuth callback redirect), 2-minute timeout
        match server.recv_timeout(std::time::Duration::from_secs(120)) {
            Ok(None) => {
                let _ = app.emit("drive-oauth-error", "Authentication timed out. Please try again.");
                return;
            }
            Ok(Some(request)) => {
                let url = request.url().to_string();

                // Parse ?code= from the query string
                let code = url.split('?').nth(1).and_then(|qs| {
                    qs.split('&').find_map(|param| {
                        let mut kv = param.splitn(2, '=');
                        if kv.next() == Some("code") {
                            kv.next().map(|v| v.to_string())
                        } else {
                            None
                        }
                    })
                });

                let html = if code.is_some() {
                    "<html><body style=\"font-family:sans-serif;padding:2rem\"><h2>&#10003; Connected to Google Drive</h2><p>You can close this tab and return to Reprise.</p></body></html>"
                } else {
                    "<html><body style=\"font-family:sans-serif;padding:2rem\"><h2>Authentication failed</h2><p>No authorization code was received. You can close this tab.</p></body></html>"
                };

                let response = tiny_http::Response::from_string(html).with_header(
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap(),
                );
                let _ = request.respond(response);

                match code {
                    Some(c) => { let _ = app.emit("drive-oauth-code", c); }
                    None    => { let _ = app.emit("drive-oauth-error", "No authorization code in callback URL"); }
                }
            }
            Err(e) => {
                let _ = app.emit("drive-oauth-error", e.to_string());
            }
        }
    });

    Ok(port)
}

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
        .invoke_handler(tauri::generate_handler![get_sidecar_path_env, start_drive_oauth_listener])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
