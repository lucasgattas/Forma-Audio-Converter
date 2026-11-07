use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn choose_input_folder(app: tauri::AppHandle, title: String) -> Result<Option<Vec<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match app.dialog().file().set_title(title).blocking_pick_folder() {
            None => Ok(None),
            Some(folder) => {
                let path = folder.into_path().map_err(|e| e.to_string())?;
                crate::folder_scan_core::scan(&path).map(Some)
            }
        }
    }).await.map_err(|e| e.to_string())?
}
