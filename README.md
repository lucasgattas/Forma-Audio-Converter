# Forma Audio Converter

A free, open-source audio converter for Windows that converts audio files in batches, entirely on your own computer. No uploads, no accounts, no cloud processing.

Forma Audio Converter is a small desktop app built with Tauri, Rust and React. It takes a list of audio files, converts them to the format you choose, and saves the results next to your originals without ever modifying or overwriting the source files.

**Download the installer:** [latest release](https://github.com/lucasgattas/Forma-Audio-Converter/releases/latest)

## What it does

- **Batch conversion.** Add any number of files, or an entire folder, and convert them in one run.
- **Six output formats.** MP3, FLAC, WAV (PCM), M4A (AAC), Ogg Vorbis and Opus.
- **Free quality control.** A continuous bitrate slider from 128 to 320 kbps for lossy formats, plus sample rate, channel count and WAV bit depth. Quality presets are shortcuts, not limits.
- **Your files stay yours.** Conversion happens locally. Originals are never modified, existing files are never overwritten, and results get a numbered name when a file with that name already exists.
- **Metadata and cover art preserved.** Tags and embedded artwork survive conversion in MP3, FLAC, M4A and Ogg/Opus.
- **Progress, cancellation and retry.** Follow each file, cancel a running batch, retry only what failed.
- **Five languages.** English, Brazilian Portuguese, Spanish, French and German, remembered between sessions.
- **No telemetry, no network access.** The app does not contact any server.

## Download and install

1. Go to the [latest release](https://github.com/lucasgattas/Forma-Audio-Converter/releases/latest).
2. Download `Forma Audio Converter_0.1.0_x64-setup.exe`.
3. Run it. The app installs for the current user, so no administrator rights are needed.

Requirements: Windows 10 or 11, 64-bit.

Notes:

- The installer is not code-signed yet, so Windows SmartScreen may warn about an unknown publisher. Choose **More info**, then **Run anyway**.
- FFmpeg is included in the installer. You do not need to install anything else.
- If Windows Defender Controlled Folder Access protects your music folder, the converter may be blocked from writing there. Choose a different destination folder, or allow the app explicitly.

Third-party components and their licenses are listed in `THIRD-PARTY-NOTICES.txt`, which the installer places next to the application. The corresponding source code is published as a release asset (`forma-0.1.0-corresponding-sources.tar.gz`).

## How it works

Forma is a thin, careful front end over FFmpeg. The Rust backend resolves `ffmpeg.exe` and `ffprobe.exe` from the bundled `local-ffmpeg` folder next to the application, verifies each file before use, and runs conversion jobs one at a time so a large batch cannot exhaust the machine.

Every conversion writes to a temporary file first and only moves it into place once it is complete, so an interrupted run never leaves a half-written file where you expected a result.

## Build from source

You need Node.js and npm, the Rust toolchain, and the Windows prerequisites for Tauri 2, including Microsoft C++ Build Tools and WebView2. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
```

In a development build the app looks for `ffmpeg` and `ffprobe` on your `PATH`, so install them yourself for local testing. To produce an installer, FFmpeg must be bundled with the application instead. Check the licenses and distribution terms of any third-party binaries you redistribute.

```sh
npm run build       # frontend only
npm run tauri build # desktop application and installer
```

## Project layout

| Path | Contents |
| --- | --- |
| `src/` | React frontend: `App.tsx`, translations, styles |
| `src-tauri/src/` | Rust backend: conversion engine, queue, tool resolution, folder scanning |
| `src-tauri/tests/`, `tests/` | Rust and Node test suites |
| `src-tauri/tauri.conf.json` | Desktop application configuration |

Tests:

```sh
node --test tests/*.test.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

## License

Forma's own source code is licensed under the [MIT License](LICENSE), copyright © 2026 Egrégora Labs.

FFmpeg and the other bundled libraries keep their own licenses and are not covered by the MIT license. See `THIRD-PARTY-NOTICES.txt` in the installed application folder.

## Contributing

Bug reports and feature requests are welcome in [Issues](https://github.com/lucasgattas/Forma-Audio-Converter/issues). If you hit a conversion that fails or produces a broken file, please say which input format, which output format and which settings you used.
