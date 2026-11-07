#[path = "folder_scan_core.rs"]
mod folder_scan_core;
use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("forma-folder-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&path).unwrap(); Self(path)
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

#[test]
fn selects_only_supported_regular_files_at_top_level() {
    let f = Fixture::new();
    fs::write(f.0.join("one.WAV"), b"audio").unwrap();
    fs::write(f.0.join("note.txt"), b"text").unwrap();
    fs::create_dir(f.0.join("sub")).unwrap();
    fs::write(f.0.join("sub").join("nested.mp3"), b"audio").unwrap();
    let files = folder_scan_core::scan(&f.0).unwrap();
    assert_eq!(files.len(), 1);
    assert!(files[0].ends_with("one.WAV"));
}

#[test]
fn missing_directory_is_an_error() {
    let f = Fixture::new();
    assert!(folder_scan_core::scan(&f.0.join("missing")).is_err());
}
