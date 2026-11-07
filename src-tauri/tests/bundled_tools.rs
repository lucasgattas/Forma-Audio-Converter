#[path = "../src/bundled_tools.rs"]
mod bundled_tools;

use bundled_tools::{resolve_bundled, Tool};
use std::fs;

#[test]
fn resolves_only_existing_regular_tools_from_absolute_bundle_directory() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(Tool::Ffmpeg.filename());
    fs::write(&path, b"synthetic, not executable").unwrap();
    assert_eq!(resolve_bundled(temp.path(), Tool::Ffmpeg).unwrap(), temp.path().canonicalize().unwrap().join(Tool::Ffmpeg.filename()));
    assert!(resolve_bundled(temp.path(), Tool::Ffprobe).is_err());
    assert!(resolve_bundled(std::path::Path::new("relative"), Tool::Ffmpeg).is_err());
    fs::create_dir(temp.path().join(Tool::Ffprobe.filename())).unwrap();
    assert!(resolve_bundled(temp.path(), Tool::Ffprobe).is_err());
}

#[cfg(windows)]
#[test]
fn rejects_bundle_directory_junction() {
    let temp = tempfile::tempdir().unwrap();
    let real = temp.path().join("real");
    let junction = temp.path().join("bundle");
    fs::create_dir(&real).unwrap();
    fs::write(real.join(Tool::Ffmpeg.filename()), b"synthetic").unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction).arg(&real).status().unwrap();
    assert!(status.success());
    assert!(resolve_bundled(&junction, Tool::Ffmpeg).is_err());
}
