use std::{fs, path::Path};

pub fn scan(directory: &Path) -> Result<Vec<String>, String> {
    let metadata = fs::symlink_metadata(directory).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Not a regular directory".into());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if !kind.is_file() || kind.is_symlink() { continue; }
        let path = entry.path();
        let supported = path.extension().and_then(|s| s.to_str()).map(|s| matches!(s.to_ascii_lowercase().as_str(), "wav" | "mp3" | "flac" | "m4a" | "aac" | "ogg" | "opus" | "aiff" | "aif" | "wma")).unwrap_or(false);
        if !supported { continue; }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        files.push(path.into_os_string().into_string().map_err(|_| "File path is not valid Unicode")?);
    }
    files.sort();
    files.dedup();
    Ok(files)
}
