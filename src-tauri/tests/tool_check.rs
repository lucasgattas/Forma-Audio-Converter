#[allow(dead_code)]
#[path = "../src/tool_check.rs"]
mod tool_check;

use std::ffi::OsStr;
use std::time::Duration;

#[cfg(not(debug_assertions))]
#[test]
fn release_diagnostics_are_disabled_without_searching_path() {
    let report = tool_check::check_tools();
    assert_eq!(report.ffmpeg.status, tool_check::ToolStatus::Failed);
    assert_eq!(report.ffprobe.status, tool_check::ToolStatus::Failed);
    assert!(report.ffmpeg.error.unwrap().contains("release policy"));
    assert!(report.ffprobe.version.is_none());
}

#[test]
fn missing_executables_are_reported_individually() {
    let report = tool_check::check_tools_with_paths(
        OsStr::new("__forma_missing_ffmpeg_987654__"),
        OsStr::new("__forma_missing_ffprobe_987654__"),
        Duration::from_millis(100),
    );
    assert_eq!(report.ffmpeg.status, tool_check::ToolStatus::NotFound);
    assert_eq!(report.ffprobe.status, tool_check::ToolStatus::NotFound);
    assert!(report.ffmpeg.version.is_none());
}

#[test]
fn resolution_failure_does_not_hide_other_tool() {
    use std::{fs, process::Command};
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("fixture.rs");
    let exe = dir.path().join(format!("fixture{}", std::env::consts::EXE_SUFFIX));
    fs::write(&source, "fn main() { println!(\"synthetic version\"); }").unwrap();
    assert!(Command::new("rustc").arg(&source).arg("-o").arg(&exe).status().unwrap().success());
    for missing_ffmpeg in [true, false] {
        let good = || Ok(exe.clone());
        let bad = || Err("Bundled tool unavailable".to_owned());
        let (ffmpeg, ffprobe) = if missing_ffmpeg { (bad(), good()) } else { (good(), bad()) };
        let report = tool_check::check_resolved_tools(ffmpeg, ffprobe, Duration::from_secs(2));
        let (missing, available) = if missing_ffmpeg { (report.ffmpeg, report.ffprobe) } else { (report.ffprobe, report.ffmpeg) };
        assert_eq!(missing.status, tool_check::ToolStatus::Failed);
        assert!(missing.error.unwrap().contains("Bundled tool unavailable"));
        assert_eq!(available.status, tool_check::ToolStatus::Available);
        assert_eq!(available.version.as_deref(), Some("synthetic version"));
    }
}

#[test]
fn long_output_is_drained_without_breaking_the_child() {
    use std::{fs, process::Command};
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("long.rs");
    let exe = dir.path().join(format!("long{}", std::env::consts::EXE_SUFFIX));
    fs::write(&source, r#"
        use std::io::{self, Write};
        fn main() {
            let mut out = io::stdout().lock();
            out.write_all(b"synthetic long version\n").unwrap();
            for _ in 0..128 { out.write_all(&[b'x'; 8192]).unwrap(); }
        }
    "#).unwrap();
    assert!(Command::new("rustc").arg(&source).arg("-o").arg(&exe).status().unwrap().success());
    let report = tool_check::check_tools_with_paths(exe.as_os_str(), exe.as_os_str(), Duration::from_secs(5));
    for result in [report.ffmpeg, report.ffprobe] {
        assert_eq!(result.status, tool_check::ToolStatus::Available, "{:?}", result.error);
        assert_eq!(result.version.as_deref(), Some("synthetic long version"));
    }
}

#[test]
fn synthetic_processes_cover_success_failure_and_timeout() {
    use std::{fs, process::Command, time::Instant};
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("fixture.rs");
    fs::write(&source, r#"
        fn main() {
            assert_eq!(std::env::args().nth(1).as_deref(), Some("-version"));
            let exe = std::env::current_exe().unwrap();
            let name = exe.file_stem().unwrap().to_string_lossy();
            if name == "slow" { std::thread::sleep(std::time::Duration::from_secs(3)); }
            if name == "bad" { std::process::exit(42); }
            if name != "empty" { println!("synthetic version 1\nextra information"); }
        }
    "#).unwrap();
    let suffix = std::env::consts::EXE_SUFFIX;
    let good = dir.path().join(format!("good{suffix}"));
    assert!(Command::new("rustc").arg(&source).arg("-o").arg(&good).status().unwrap().success());
    let bad = dir.path().join(format!("bad{suffix}"));
    let slow = dir.path().join(format!("slow{suffix}"));
    let empty = dir.path().join(format!("empty{suffix}"));
    for target in [&bad, &slow, &empty] { fs::copy(&good, target).unwrap(); }
    let report = tool_check::check_tools_with_paths(good.as_os_str(), bad.as_os_str(), Duration::from_secs(2));
    assert_eq!(report.ffmpeg.status, tool_check::ToolStatus::Available);
    assert_eq!(report.ffmpeg.version.as_deref(), Some("synthetic version 1"));
    assert_eq!(report.ffprobe.status, tool_check::ToolStatus::Failed);
    assert!(report.ffprobe.error.unwrap().contains("42"));
    let start = Instant::now();
    let report = tool_check::check_tools_with_paths(slow.as_os_str(), empty.as_os_str(), Duration::from_millis(300));
    assert_eq!(report.ffmpeg.status, tool_check::ToolStatus::TimedOut);
    assert_eq!(report.ffprobe.status, tool_check::ToolStatus::Failed);
    assert!(start.elapsed() < Duration::from_secs(2));
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["ffmpeg"]["status"], "timed_out");
}
