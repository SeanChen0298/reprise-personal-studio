#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Trace)
                .with_tag("REPRISE"),
        );
    }
    log::error!("REPRISE: run() called");
    
    let result = std::panic::catch_unwind(|| {
        tauri::Builder::default()
            .plugin(tauri_plugin_os::init())
            .run(tauri::generate_context!())
    });
    
    match result {
        Ok(Ok(())) => log::error!("REPRISE: tauri exited cleanly"),
        Ok(Err(e)) => log::error!("REPRISE: tauri error: {:?}", e),
        Err(e) => log::error!("REPRISE: PANIC: {:?}", e),
    }
}