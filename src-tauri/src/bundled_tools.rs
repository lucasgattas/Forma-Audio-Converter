use std::{fs, path::{Path, PathBuf}};

#[derive(Clone, Copy)]
pub enum Tool { Ffmpeg, Ffprobe }

impl Tool {
    pub fn filename(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Tool::Ffmpeg, true) => "ffmpeg.exe",
            (Tool::Ffprobe, true) => "ffprobe.exe",
            (Tool::Ffmpeg, false) => "ffmpeg",
            (Tool::Ffprobe, false) => "ffprobe",
        }
    }
}

// This only resolves a location; it does not authenticate binaries or their DLLs.
#[allow(dead_code)]
pub fn resolve_bundled(directory: &Path, tool: Tool) -> Result<PathBuf, &'static str> {
    if !directory.is_absolute() { return Err("Bundle directory must be absolute"); }
    let metadata = fs::symlink_metadata(directory).map_err(|_| "Bundle directory unavailable")?;
    if !metadata.is_dir() || is_redirect(&metadata) { return Err("Bundle directory is not a regular directory"); }
    let directory = directory.canonicalize().map_err(|_| "Bundle directory unavailable")?;
    if !directory.is_dir() { return Err("Bundle directory unavailable"); }
    let path = directory.join(tool.filename());
    let metadata = fs::symlink_metadata(&path).map_err(|_| "Bundled tool unavailable")?;
    if !metadata.file_type().is_file() || is_redirect(&metadata) { return Err("Bundled tool is not a regular file"); }
    Ok(path)
}

fn is_redirect(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    { metadata.file_type().is_symlink() }
}
