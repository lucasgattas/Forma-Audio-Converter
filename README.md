# Forma Audio Converter

Forma Audio Converter is a Windows desktop application for converting audio files locally in batches. Its source uses Tauri, Rust, React, and FFmpeg tools.

> **Availability:** An installer is not yet publicly available. The project is not ready for public binary distribution: the FFmpeg binaries and their distribution obligations have not been cleared. Do not treat a locally built or experimental installer as an official release.

## What the source implements

- Add individual audio files or a folder to a conversion queue. Folder selection does not include subfolders and ignores symbolic links.
- Choose MP3, FLAC, WAV (PCM), M4A (AAC), Ogg Vorbis, or Opus in Ogg as the output format. Actual support depends on the available FFmpeg build and its codecs.
- Set a destination and adjust applicable bitrate, sample rate, channels, and WAV bit depth. Estimated output sizes are approximate and may be unavailable.
- Monitor conversion status and cancel a running batch. Output naming avoids overwriting existing files, including the original.
- For WAV output, the interface offers an explicit option to omit embedded cover art from converted files; the original is not changed.

## Installation

There is no public installer to download yet. End users should wait for a publicly announced release; the source-development instructions below are not an installer or a distribution-ready build.

## Development on Windows

You need Node.js and npm, the Rust toolchain, and the Windows prerequisites for Tauri 2, including Microsoft C++ Build Tools and WebView2. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup details.

For conversion in a development build, install FFmpeg and FFprobe separately from a source you trust and make both executables available on `PATH`. Their availability alone does not guarantee that the build includes every encoder needed by Forma. Check the licenses and distribution terms of any third-party binaries you use.

From the project directory:

```sh
npm install
npm run tauri dev
```

The development app checks both tools before enabling conversion. This is a development workflow, not a public installation method. `npm run build` builds the frontend only.

### Release constraint

The normal release configuration has bundling disabled, and ordinary release builds deliberately block conversion rather than using FFmpeg from `PATH`. The source also contains a separate local-installer test feature; it is for private experimentation, not authorization to redistribute FFmpeg or publish an installer. A release requires review of the exact binaries, dependencies, source and license obligations, and the final package.

## License

Forma's source is licensed under the [MIT License](LICENSE), copyright © 2026 Egrégora Labs. FFmpeg and other third-party components have their own licenses and are not covered by Forma's MIT license.
