use serde::Serialize;
use std::ffi::OsStr;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Available,
    NotFound,
    Failed,
    TimedOut,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub status: ToolStatus,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolsReport {
    pub ffmpeg: ToolResult,
    pub ffprobe: ToolResult,
}

/// Checks whether each tool runs successfully; this does not inspect codecs.
pub fn check_tools() -> ToolsReport {
    if !cfg!(debug_assertions) {
        return disabled_report();
    }
    check_tools_with_paths(OsStr::new("ffmpeg"), OsStr::new("ffprobe"), Duration::from_secs(5))
}

pub fn disabled_report() -> ToolsReport {
    let disabled = || failure(ToolStatus::Failed, "Tool execution disabled by release policy".into());
    ToolsReport { ffmpeg: disabled(), ffprobe: disabled() }
}

/// The timeout applies independently to each executable.
pub fn check_tools_with_paths(ffmpeg: &OsStr, ffprobe: &OsStr, timeout: Duration) -> ToolsReport {
    ToolsReport {
        ffmpeg: check_one(ffmpeg, timeout),
        ffprobe: check_one(ffprobe, timeout),
    }
}

/// Resolve and diagnose each experimental tool independently.
pub fn check_resolved_tools(ffmpeg: Result<std::path::PathBuf, String>, ffprobe: Result<std::path::PathBuf, String>, timeout: Duration) -> ToolsReport {
    fn check(path: Result<std::path::PathBuf, String>, timeout: Duration) -> ToolResult {
        match path {
            Ok(path) => check_one(path.as_os_str(), timeout),
            Err(error) => failure(ToolStatus::Failed, error),
        }
    }
    ToolsReport { ffmpeg: check(ffmpeg, timeout), ffprobe: check(ffprobe, timeout) }
}

fn failure(status: ToolStatus, message: String) -> ToolResult {
    ToolResult { status, version: None, error: Some(message) }
}

fn check_one(path: &OsStr, timeout: Duration) -> ToolResult {
    let name = path.to_string_lossy();
    let started = Instant::now();
    let mut command = Command::new(path);
    command.arg("-version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let status = if e.kind() == std::io::ErrorKind::NotFound { ToolStatus::NotFound } else { ToolStatus::Failed };
            return failure(status, format!("Could not start {name}: {e}"));
        }
    };
    let mut stdout = child.stdout.take().expect("stdout was piped");
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = (|| -> std::io::Result<Vec<u8>> {
            let mut buffer = [0u8; 8192];
            loop {
                let count = stdout.read(&mut buffer)?;
                if count == 0 { break; }
                let retained = count.min(8192usize.saturating_sub(bytes.len()));
                bytes.extend_from_slice(&buffer[..retained]);
            }
            Ok(bytes)
        })();
        let _ = sender.send(result);
    });
    loop {
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => return failure(ToolStatus::Failed, format!("{name} -version exited with {status}")),
            Ok(Some(_)) => break,
            Ok(None) => {},
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return failure(ToolStatus::Failed, format!("Could not wait for {name}: {e}"));
            }
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return failure(ToolStatus::TimedOut, format!("{name} -version timed out after {} ms", timeout.as_millis()));
        }
        thread::sleep(Duration::from_millis(10).min(timeout.saturating_sub(started.elapsed())));
    }
    match receiver.recv_timeout(timeout.saturating_sub(started.elapsed())) {
        Ok(Ok(bytes)) => {
            let output = String::from_utf8_lossy(&bytes);
            let line = output.lines().next().unwrap_or("").trim();
            if line.is_empty() {
                failure(ToolStatus::Failed, format!("{name} -version returned no version output"))
            } else {
                ToolResult { status: ToolStatus::Available, version: Some(line.to_owned()), error: None }
            }
        }
        Ok(Err(e)) => failure(ToolStatus::Failed, format!("Could not read {name} output: {e}")),
        Err(_) => failure(ToolStatus::TimedOut, format!("Timed out reading {name} version output")),
    }
}
