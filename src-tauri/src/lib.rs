use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

/// Files handed to us by Finder ("Open With…" / double-click) before the
/// webview was ready to receive events.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Drain any file paths macOS asked us to open before the frontend mounted.
#[tauri::command]
fn take_opened_files(state: State<'_, OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    #[test]
    fn file_size_reports_length() {
        let path = std::env::temp_dir().join("pdf-studio-test-size.bin");
        std::fs::write(&path, [0u8; 1234]).unwrap();
        let got = super::file_size(path.to_string_lossy().into_owned()).unwrap();
        std::fs::remove_file(&path).ok();
        assert_eq!(got, 1234);
    }

    #[test]
    fn file_size_errors_on_missing_file() {
        assert!(super::file_size("/nonexistent/definitely-missing".into()).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OpenedFiles::default())
        .invoke_handler(tauri::generate_handler![file_size, take_opened_files])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Finder integration: deliver "Open With" / dock-drop file paths.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let files: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if files.is_empty() {
                    return;
                }
                // Buffer for the frontend in case it hasn't mounted yet…
                if let Some(state) = app.try_state::<OpenedFiles>() {
                    state.0.lock().unwrap().extend(files.clone());
                }
                // …and also emit for when it has.
                let _ = app.emit("files-opened", files);
            }
        });
}
