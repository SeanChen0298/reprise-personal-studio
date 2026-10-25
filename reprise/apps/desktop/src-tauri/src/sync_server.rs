//! Phone sync over the home Wi-Fi.
//!
//! While switched on (Settings → Phone), a small HTTP server on the local
//! network lets the Reprise phone app pull the library snapshot the webview
//! writes to `<root>/sync/library.json`, download a song's audio files, and
//! push back takes / changes into `<root>/sync/inbox/`, which the webview
//! imports. Every request needs the pairing token; files are only served from
//! under the Reprise folder.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

/// Files the phone may download.
const SERVED_EXTENSIONS: &[&str] = &["m4a", "mp3", "wav", "webm", "opus", "ogg", "aac", "flac", "json", "csv", "jpg", "jpeg", "png", "webp"];
/// Biggest upload accepted (a long take as m4a is far below this).
const MAX_UPLOAD_BYTES: u64 = 300 * 1024 * 1024;

pub struct SyncServer {
    server: Arc<Server>,
    port: u16,
    ip: String,
}

#[derive(Default)]
pub struct SyncState(pub Mutex<Option<SyncServer>>);

#[derive(Serialize, Clone)]
pub struct SyncStatus {
    running: bool,
    ip: Option<String>,
    port: Option<u16>,
}

fn status_of(s: &Option<SyncServer>) -> SyncStatus {
    match s {
        Some(s) => SyncStatus { running: true, ip: Some(s.ip.clone()), port: Some(s.port) },
        None => SyncStatus { running: false, ip: None, port: None },
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn json_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
}

fn error(req: Request, status: u16, msg: &str) {
    let body = serde_json::json!({ "error": msg }).to_string();
    let _ = req.respond(json_response(status, body));
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        (k == key).then(|| percent_decode(v))
    })
}

/// Constant-time-ish comparison, so the token can't be guessed byte by byte.
fn same(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn authorised(req: &Request, token: &str) -> bool {
    let from_header = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("X-Reprise-Token"))
        .map(|h| h.value.as_str().to_string());
    let given = from_header.or_else(|| query_param(req.url(), "token"));
    matches!(given, Some(g) if same(&g, token))
}

/// The file at `requested`, if it's inside `root` and a servable type.
fn servable(root: &Path, requested: &str) -> Option<PathBuf> {
    let path = fs::canonicalize(requested).ok()?;
    let root = fs::canonicalize(root).ok()?;
    if !path.starts_with(&root) || !path.is_file() {
        return None;
    }
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    SERVED_EXTENSIONS.contains(&ext.as_str()).then_some(path)
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("webm") => "audio/webm",
        Some("opus") | Some("ogg") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn send_file(req: Request, path: &Path) {
    match File::open(path) {
        Ok(f) => {
            let len = f.metadata().map(|m| m.len()).ok();
            let resp = Response::new(StatusCode(200), vec![header("Content-Type", content_type(path))], f, len.map(|l| l as usize), None);
            let _ = req.respond(resp);
        }
        Err(_) => error(req, 404, "not found"),
    }
}

fn safe_name(name: &str) -> Option<String> {
    let ok = !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    ok.then(|| name.to_string())
}

fn receive_upload(mut req: Request, inbox: &Path) {
    let Some(name) = query_param(req.url(), "name").and_then(|n| safe_name(&n)) else {
        return error(req, 400, "bad file name");
    };
    if req.body_length().map(|l| l as u64 > MAX_UPLOAD_BYTES).unwrap_or(false) {
        return error(req, 413, "too large");
    }
    if fs::create_dir_all(inbox).is_err() {
        return error(req, 500, "can't create inbox");
    }
    let part = inbox.join(format!("{name}.part"));
    let result = (|| -> std::io::Result<u64> {
        let mut out = File::create(&part)?;
        let mut reader = req.as_reader().take(MAX_UPLOAD_BYTES + 1);
        let mut buf = vec![0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > MAX_UPLOAD_BYTES {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, "too large"));
            }
            out.write_all(&buf[..n])?;
        }
        out.flush()?;
        Ok(total)
    })();
    match result {
        Ok(bytes) => {
            // Only complete files appear under their real name, so the importer never sees half a file.
            let dest = inbox.join(&name);
            let _ = fs::remove_file(&dest);
            if fs::rename(&part, &dest).is_err() {
                let _ = fs::remove_file(&part);
                return error(req, 500, "can't save");
            }
            let _ = req.respond(json_response(200, serde_json::json!({ "ok": true, "bytes": bytes }).to_string()));
        }
        Err(_) => {
            let _ = fs::remove_file(&part);
            error(req, 500, "upload failed")
        }
    }
}

fn handle(req: Request, root: &Path, token: &str, host: &str) {
    if !authorised(&req, token) {
        return error(req, 401, "not paired");
    }
    let path = req.url().split('?').next().unwrap_or("").to_string();
    match (req.method(), path.as_str()) {
        (Method::Get, "/ping") => {
            let body = serde_json::json!({ "app": "reprise", "version": 1, "host": host }).to_string();
            let _ = req.respond(json_response(200, body));
        }
        (Method::Get, "/library") => {
            let lib = root.join("sync").join("library.json");
            if lib.is_file() {
                // Lets the desktop show when the phone last synced.
                let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                let _ = fs::write(root.join("sync").join("last-pull.txt"), secs.to_string());
                send_file(req, &lib)
            } else {
                error(req, 503, "library not ready")
            }
        }
        (Method::Get, "/file") => match query_param(req.url(), "path").and_then(|p| servable(root, &p)) {
            Some(p) => send_file(req, &p),
            None => error(req, 404, "not found"),
        },
        (Method::Post, "/upload") | (Method::Put, "/upload") => receive_upload(req, &root.join("sync").join("inbox")),
        _ => error(req, 404, "unknown"),
    }
}

/// The machine's address on the local network (what the phone connects to).
fn lan_ip() -> String {
    local_ip_address::local_ip().map(|ip| ip.to_string()).unwrap_or_else(|_| "127.0.0.1".into())
}

#[tauri::command]
pub fn sync_server_start(state: tauri::State<SyncState>, root: String, token: String, port: u16) -> Result<SyncStatus, String> {
    let mut guard = state.0.lock().map_err(|_| "busy")?;
    if let Some(old) = guard.take() {
        old.server.unblock();
    }
    if token.len() < 16 {
        return Err("token too short".into());
    }
    let server = Arc::new(Server::http(("0.0.0.0", port)).map_err(|e| format!("couldn't listen on port {port}: {e}"))?);
    let ip = lan_ip();
    let host = hostname();
    let root = PathBuf::from(root);
    let s2 = server.clone();
    thread::spawn(move || {
        for req in s2.incoming_requests() {
            let (root, token, host) = (root.clone(), token.clone(), host.clone());
            // Downloads can take a while; don't hold up other requests.
            thread::spawn(move || handle(req, &root, &token, &host));
        }
    });
    *guard = Some(SyncServer { server, port, ip });
    Ok(status_of(&guard))
}

#[tauri::command]
pub fn sync_server_stop(state: tauri::State<SyncState>) -> Result<SyncStatus, String> {
    let mut guard = state.0.lock().map_err(|_| "busy")?;
    if let Some(old) = guard.take() {
        old.server.unblock();
    }
    Ok(status_of(&guard))
}

#[tauri::command]
pub fn sync_server_status(state: tauri::State<SyncState>) -> Result<SyncStatus, String> {
    let mut guard = state.0.lock().map_err(|_| "busy")?;
    // The network may have changed since it started.
    if let Some(s) = guard.as_mut() {
        s.ip = lan_ip();
    }
    Ok(status_of(&guard))
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Desktop".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_queries() {
        assert_eq!(percent_decode("C%3A%2FReprise%2Fa%20b.m4a"), "C:/Reprise/a b.m4a");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(query_param("/file?token=abc&path=C%3A%2Fx", "path").as_deref(), Some("C:/x"));
        assert_eq!(query_param("/file?token=abc", "path"), None);
    }

    #[test]
    fn names_and_tokens() {
        assert!(safe_name("take-1.m4a").is_some());
        assert!(safe_name("../x").is_none());
        assert!(safe_name("a/b").is_none());
        assert!(same("abcdef", "abcdef"));
        assert!(!same("abcdef", "abcdeg"));
    }

    #[test]
    fn serves_only_inside_root() {
        let dir = std::env::temp_dir().join("reprise-sync-test");
        let root = dir.join("root");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.m4a"), b"x").unwrap();
        fs::write(root.join("a.exe"), b"x").unwrap();
        fs::write(dir.join("outside.m4a"), b"x").unwrap();
        assert!(servable(&root, root.join("a.m4a").to_str().unwrap()).is_some());
        assert!(servable(&root, root.join("a.exe").to_str().unwrap()).is_none());
        assert!(servable(&root, root.join("../outside.m4a").to_str().unwrap()).is_none());
    }

    fn http(port: u16, raw: &str) -> String {
        use std::io::{Read, Write};
        let mut c = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        c.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        c.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn end_to_end() {
        let root = std::env::temp_dir().join("reprise-sync-e2e");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sync")).unwrap();
        fs::write(root.join("sync").join("library.json"), b"{\"ok\":1}").unwrap();
        fs::write(root.join("song.m4a"), b"AUDIO").unwrap();
        let server = Arc::new(Server::http(("127.0.0.1", 0)).unwrap());
        let port = server.server_addr().to_ip().unwrap().port();
        let s2 = server.clone();
        let r2 = root.clone();
        thread::spawn(move || {
            for req in s2.incoming_requests() {
                handle(req, &r2, "tok-tok-tok-tok-tok", "test");
            }
        });
        let tok = "X-Reprise-Token: tok-tok-tok-tok-tok\r\n";
        let end = "Host: x\r\nConnection: close\r\n\r\n";
        assert!(http(port, &format!("GET /library HTTP/1.1\r\n{end}")).starts_with("HTTP/1.1 401"));
        let lib = http(port, &format!("GET /library HTTP/1.1\r\n{tok}{end}"));
        assert!(lib.starts_with("HTTP/1.1 200") && lib.ends_with("{\"ok\":1}"), "{lib}");
        let path = root.join("song.m4a").to_string_lossy().replace('\\', "/").replace(':', "%3A");
        let f = http(port, &format!("GET /file?token=tok-tok-tok-tok-tok&path={path} HTTP/1.1\r\n{end}"));
        assert!(f.starts_with("HTTP/1.1 200") && f.ends_with("AUDIO"), "{f}");
        let outside = http(port, &format!("GET /file?path=C%3A%2FWindows%2Fwin.ini HTTP/1.1\r\n{tok}{end}"));
        assert!(outside.starts_with("HTTP/1.1 404"), "{outside}");
        let up = http(port, &format!("POST /upload?name=t1.m4a HTTP/1.1\r\n{tok}Content-Length: 4\r\n{end}TAKE"));
        assert!(up.starts_with("HTTP/1.1 200"), "{up}");
        assert_eq!(fs::read(root.join("sync").join("inbox").join("t1.m4a")).unwrap(), b"TAKE");
        let bad = http(port, &format!("POST /upload?name=..%2Fevil.m4a HTTP/1.1\r\n{tok}Content-Length: 4\r\n{end}TAKE"));
        assert!(bad.starts_with("HTTP/1.1 400"), "{bad}");
        assert!(root.join("sync").join("last-pull.txt").is_file());
        server.unblock();
    }
}
