use super::*;
use std::sync::atomic::AtomicBool;

fn wav(path: &Path) {
    let status = binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y"]).arg(path).status().unwrap();
    assert!(status.success());
}

#[test]
fn wav_cover_removal_requires_explicit_consent_and_preserves_existing_files() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.flac");
    assert!(binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "lavfi", "-i", "color=red:s=32x32", "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-c:v", "png", "-t", "1", "-disposition:v", "attached_pic", "-y"]).arg(&input).status().unwrap().success());
    let original = std::fs::read(&input).unwrap();
    let output = dir.path().join("result.wav");
    std::fs::write(&output, b"existing").unwrap();
    assert!(convert_advanced(&AtomicBool::new(false), &input, &output, "wav", 192, ConversionOptions::default(), |_| {}).is_err());
    let options = ConversionOptions { allow_wav_without_cover: true, ..Default::default() };
    let result = convert_advanced(&AtomicBool::new(false), &input, &output, "wav", 192, options, |_| {}).unwrap();
    assert_ne!(result, output);
    assert_eq!(cover_count(&result).unwrap(), 0);
    assert_eq!(std::fs::read(&output).unwrap(), b"existing");
    assert_eq!(std::fs::read(&input).unwrap(), original);
}

#[test]
fn cover_limit_boundaries() {
    assert!(valid_cover_limits(1, 1, 1));
    assert!(valid_cover_limits(MAX_OGG_COVER_BYTES, 4096, 4096));
    for (size, width, height) in [(0, 1, 1), (MAX_OGG_COVER_BYTES + 1, 1, 1), (1, 0, 1), (1, 1, 0), (1, 4097, 1), (1, 1, 4097)] {
        assert!(!valid_cover_limits(size, width, height));
    }
}

#[test]
fn large_png_and_jpeg_survive_ogg_and_opus_byte_for_byte() {
    let dir = tempfile::tempdir().unwrap();
    for codec in ["png", "mjpeg"] {
        let input = dir.path().join(format!("source-{codec}.flac"));
        let status = binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "lavfi", "-i", "testsrc2=size=1024x1024:rate=1", "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-c:v", codec, "-frames:v", "1", "-disposition:v", "attached_pic", "-metadata", "title=Large cover", "-y"]).arg(&input).status().unwrap();
        assert!(status.success());
        let original = std::fs::read(&input).unwrap();
        let cover = ogg_cover(&input).unwrap().0;
        assert!(cover.len() > 16000, "{codec}: {}", cover.len());
        for format in ["ogg", "opus"] {
            let output = dir.path().join(format!("{codec}.{format}"));
            std::fs::write(&output, b"existing").unwrap();
            let result = convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap();
            assert_eq!(std::fs::read(&output).unwrap(), b"existing");
            assert_eq!(cover_count(&result).unwrap(), 1);
            assert_eq!(ogg_cover(&result).unwrap().0, cover);
            let info = binary("ffprobe").unwrap().args(["-v", "error", "-show_entries", "format_tags=title:stream_tags=title", "-of", "json"]).arg(&result).output().unwrap();
            let info: serde_json::Value = serde_json::from_slice(&info.stdout).unwrap();
            assert!(info["format"]["tags"]["title"] == "Large cover" || info["streams"].as_array().unwrap().iter().any(|s| s["tags"]["title"] == "Large cover"), "{info}");
        }
        assert_eq!(std::fs::read(&input).unwrap(), original);
    }
}

#[test]
fn ogg_and_opus_preserve_real_cover_and_never_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.flac");
    assert!(binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "lavfi", "-i", "color=red:s=32x32", "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-c:v", "png", "-t", "1", "-disposition:v", "attached_pic", "-y"]).arg(&input).status().unwrap().success());
    let original = std::fs::read(&input).unwrap();
    let extract = |path: &Path| binary("ffmpeg").unwrap().args(["-v", "error", "-i"]).arg(path).args(["-map", "0:v:0", "-c", "copy", "-f", "image2pipe", "pipe:1"]).output().unwrap().stdout;
    let cover = extract(&input);
    assert!(!cover.is_empty());
    for format in ["ogg", "opus"] {
        let output = dir.path().join(format!("result.{format}"));
        std::fs::write(&output, b"existing").unwrap();
        let result = convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap();
        assert_eq!(std::fs::read(&output).unwrap(), b"existing");
        assert_eq!(cover_count(&result).unwrap(), 1);
        assert_eq!(extract(&result), cover);
    }
    assert_eq!(std::fs::read(input).unwrap(), original);
}

#[test]
fn ogg_rejects_multiple_covers_and_wav_rejects_cover() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("multiple.flac");
    assert!(binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "lavfi", "-i", "color=red:s=32x32", "-f", "lavfi", "-i", "color=blue:s=32x32", "-map", "0:a", "-map", "1:v", "-map", "2:v", "-c:a", "flac", "-c:v", "png", "-t", "1", "-disposition:v", "attached_pic", "-y"]).arg(&input).status().unwrap().success());
    assert_eq!(cover_count(&input).unwrap(), 2);
    let original = std::fs::read(&input).unwrap();
    for format in ["ogg", "opus", "wav"] {
        let output = dir.path().join(format!("result.{format}"));
        let err = convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap_err();
        assert!(err.contains("capa"), "{err}");
        assert!(!output.exists());
    }
    assert_eq!(std::fs::read(input).unwrap(), original);
}

#[test]
fn bmp_cover_is_preserved_or_reported_without_touching_original() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.flac");
    let status = binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-f", "lavfi", "-i", "color=red:s=32x32", "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-c:v", "bmp", "-t", "1", "-disposition:v", "attached_pic", "-metadata", "title=Cover test", "-y"]).arg(&input).status().unwrap();
    assert!(status.success());
    let original = std::fs::read(&input).unwrap();
    for format in ["mp3", "m4a", "flac"] {
        let output = dir.path().join(format!("result.{format}"));
        convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap();
        let result = binary("ffprobe").unwrap().args(["-v", "error", "-show_entries", "stream=codec_type:stream_disposition=attached_pic:format_tags=title", "-of", "json"]).arg(&output).output().unwrap();
        assert!(result.status.success(), "{format}");
        let data: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(data["format"]["tags"]["title"], "Cover test", "{format}");
        assert!(data["streams"].as_array().unwrap().iter().any(|s| s["disposition"]["attached_pic"] == 1), "{format}: {data}");
    }
    for format in ["wav", "ogg", "opus"] {
        let output = dir.path().join(format!("result.{format}"));
        let error = convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap_err();
        assert!(error.contains("capa"), "{format}: {error}");
        assert!(!output.exists());
    }
    assert_eq!(std::fs::read(input).unwrap(), original);
}

#[test]
fn preserves_attached_cover_and_title_in_mp3_flac_and_m4a() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.mp3");
    let status = binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "lavfi", "-i", "color=c=red:s=32x32", "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "mjpeg", "-frames:v", "1", "-disposition:v", "attached_pic", "-metadata", "title=Test title", "-y"]).arg(&input).status().unwrap();
    assert!(status.success());
    let original = std::fs::read(&input).unwrap();
    for format in ["mp3", "flac", "m4a"] {
        let output = dir.path().join(format!("result.{format}"));
        convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap();
        let result = binary("ffprobe").unwrap().args(["-v", "error", "-show_entries", "stream=codec_type:stream_disposition=attached_pic:format_tags=title", "-of", "json"]).arg(&output).output().unwrap();
        assert!(result.status.success());
        let data: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
        assert_eq!(data["format"]["tags"]["title"], "Test title", "{format}");
        assert!(data["streams"].as_array().unwrap().iter().any(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] == 1), "{format}: {data}");
    }
    assert_eq!(std::fs::read(input).unwrap(), original);
}

#[test]
fn metadata_and_cover_behavior_across_output_formats() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.mp3");
    let status = binary("ffmpeg").unwrap().args(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "lavfi", "-i", "color=c=red:s=32x32", "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "mjpeg", "-frames:v", "1", "-disposition:v", "attached_pic", "-metadata", "title=Test title", "-y"]).arg(&input).status().unwrap();
    assert!(status.success());
    for format in ["mp3", "flac", "m4a", "wav", "ogg", "opus"] {
        let output = dir.path().join(format!("result.{format}"));
        if format == "wav" {
            let error = convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap_err();
            assert!(error.contains("capa"));
            assert!(!output.exists());
            continue;
        }
        convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap();
        let result = binary("ffprobe").unwrap().args(["-v", "error", "-show_entries", "stream=codec_type:stream_tags=title:stream_disposition=attached_pic:format_tags=title", "-of", "json"]).arg(&output).output().unwrap();
        assert!(result.status.success());
        let data: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
        println!("{format}: {data}");
    }
}

#[test]
fn converts_real_wav_to_both_formats() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("áudio teste.wav");
    wav(&input);
    for format in ["mp3", "flac"] {
        let output = dir.path().join(format!("áudio teste.{format}"));
        let mut progress = Vec::new();
        convert_with_progress(&AtomicBool::new(false), &input, &output, format, 320, |p| progress.push(p)).unwrap();
        assert!(output.exists());
        let info = probe(&output).unwrap();
        assert_eq!(info.codec.as_deref(), Some(format));
        assert!(info.duration.unwrap() >= 2.0);
        assert!(!progress.is_empty());
    }
}

#[test]
fn converts_non_wav_input_to_new_formats() {
    let dir = tempfile::tempdir().unwrap();
    let wav_input = dir.path().join("source.wav");
    let input = dir.path().join("source.flac");
    wav(&wav_input);
    convert_with_progress(&AtomicBool::new(false), &wav_input, &input, "flac", 192, |_| {}).unwrap();
    for (format, codec) in [("m4a", "aac"), ("ogg", "vorbis"), ("opus", "opus")] {
        let output = dir.path().join(format!("result.{format}"));
        convert_with_progress(&AtomicBool::new(false), &input, &output, format, 192, |_| {}).unwrap();
        assert_eq!(probe(&output).unwrap().codec.as_deref(), Some(codec));
    }
}

#[test]
fn advanced_options_convert_and_reject_invalid_values() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.wav");
    wav(&input);
    let original = std::fs::read(&input).unwrap();
    for (bits, codec) in [(16, "pcm_s16le"), (24, "pcm_s24le")] {
        let output = dir.path().join(format!("out{bits}.wav"));
        let options = ConversionOptions { sample_rate: Some(48000), channels: Some(2), wav_bit_depth: Some(bits), ..Default::default() };
        convert_advanced(&AtomicBool::new(false), &input, &output, "wav", 192, options, |_| {}).unwrap();
        let info = probe(&output).unwrap();
        assert_eq!(info.codec.as_deref(), Some(codec));
        assert_eq!(info.sample_rate, Some(48000));
        assert_eq!(info.channels, Some(2));
    }
    for options in [
        ConversionOptions { sample_rate: Some(12345), ..Default::default() },
        ConversionOptions { channels: Some(3), ..Default::default() },
        ConversionOptions { wav_bit_depth: Some(32), ..Default::default() },
    ] {
        let output = dir.path().join("invalid.wav");
        assert!(convert_advanced(&AtomicBool::new(false), &input, &output, "wav", 192, options, |_| {}).is_err());
        assert!(!output.exists());
    }
    assert_eq!(std::fs::read(&input).unwrap(), original);
    let copy = convert_advanced(&AtomicBool::new(false), &input, &input, "wav", 192, ConversionOptions::default(), |_| {}).unwrap();
    assert_eq!(copy, dir.path().join("source (1).wav"));
    assert_eq!(probe(&copy).unwrap().codec.as_deref(), Some("pcm_s16le"));
    assert_eq!(std::fs::read(&input).unwrap(), original);
}

#[test]
fn defaults_preserve_source_rate_and_channels() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.wav");
    let output = dir.path().join("result.flac");
    wav(&input);
    convert_with_progress(&AtomicBool::new(false), &input, &output, "flac", 192, |_| {}).unwrap();
    let source = probe(&input).unwrap();
    let result = probe(&output).unwrap();
    assert_eq!(result.sample_rate, source.sample_rate);
    assert_eq!(result.channels, source.channels);
}

#[test]
fn strict_option_allowlists() {
    for rate in [22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000] {
        assert!(ConversionOptions { sample_rate: Some(rate), ..Default::default() }.validate("wav").is_ok());
    }
    for channels in [1, 2] {
        assert!(ConversionOptions { channels: Some(channels), ..Default::default() }.validate("wav").is_ok());
    }
    assert!(ConversionOptions { wav_bit_depth: Some(16), ..Default::default() }.validate("mp3").is_err());
    assert!(ConversionOptions { sample_rate: Some(0), ..Default::default() }.validate("wav").is_err());
    assert!(ConversionOptions { channels: Some(0), ..Default::default() }.validate("wav").is_err());
}

#[test]
fn wav_defaults_to_pcm_16() {
    assert_eq!(output_settings("wav", 192).unwrap(), ("pcm_s16le", "wav"));
}

#[test]
fn output_contract_rejects_invalid_formats_and_bitrates() {
    for format in ["mp3", "m4a", "ogg", "opus"] {
        for bitrate in 128..=320 {
            assert!(output_settings(format, bitrate).is_ok(), "{format} {bitrate}");
        }
        for bitrate in [0, 127, 321, u32::MAX] {
            assert!(output_settings(format, bitrate).is_err());
        }
    }
    for format in ["flac", "wav"] {
        for bitrate in [0, 127, 321, u32::MAX] {
            assert!(output_settings(format, bitrate).is_ok());
        }
    }
    for format in ["aac", "vorbis", "mp4", "MP3", "../mp3", ""] {
        assert!(output_settings(format, 192).is_err());
    }
}

#[test]
fn intermediate_bitrate_converts_synthetic_audio_and_rejects_out_of_range() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("source.wav");
    wav(&input);
    let original = std::fs::read(&input).unwrap();
    let output = dir.path().join("result.m4a");
    convert_with_progress(&AtomicBool::new(false), &input, &output, "m4a", 201, |_| {}).unwrap();
    assert_eq!(probe(&output).unwrap().codec.as_deref(), Some("aac"));
    for format in ["mp3", "m4a", "ogg", "opus"] {
        for bitrate in [127, 321] {
            let rejected = dir.path().join(format!("invalid-{format}-{bitrate}.{format}"));
            assert!(convert_with_progress(&AtomicBool::new(false), &input, &rejected, format, bitrate, |_| {}).is_err());
            assert!(!rejected.exists());
        }
    }
    assert_eq!(std::fs::read(&input).unwrap(), original);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
fn temporary_creation_error_preserves_os_details() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    wav(&input);
    let missing = dir.path().join("missing");
    let os_error = tempfile::Builder::new().prefix(".audio-converter-").tempfile_in(&missing).unwrap_err().to_string();
    let os_detail = os_error.split(" at path ").next().unwrap();
    let error = convert_with_progress(&AtomicBool::new(false), &input, &missing.join("result.mp3"), "mp3", 192, |_| {}).unwrap_err();
    assert!(error.contains("Não foi possível criar o arquivo temporário"), "{error}");
    assert!(error.contains(os_detail), "missing OS error details: {error}");
    assert!(!missing.exists());
}

#[test]
fn existing_output_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    let output = dir.path().join("input.mp3");
    wav(&input);
    std::fs::write(&output, b"original").unwrap();
    convert_with_progress(&AtomicBool::new(false), &input, &output, "mp3", 192, |_| {}).unwrap();
    assert_eq!(std::fs::read(&output).unwrap(), b"original");
    assert_eq!(probe(&dir.path().join("input (1).mp3")).unwrap().codec.as_deref(), Some("mp3"));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 3);
}

#[test]
fn concurrent_same_name_conversions_publish_distinct_results() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    let dest = dir.path().join("dest");
    for path in [&a, &b, &dest] { std::fs::create_dir(path).unwrap(); }
    let first = a.join("song.part.wav");
    let second = b.join("song.part.wav");
    wav(&first);
    wav(&second);
    let original_a = std::fs::read(&first).unwrap();
    let original_b = std::fs::read(&second).unwrap();
    let output = dest.join("song.part.mp3");
    std::fs::write(&output, b"existing").unwrap();
    std::fs::write(dest.join("song.part (1).mp3"), b"existing copy").unwrap();
    let barrier = std::sync::Barrier::new(2);
    let run = |input: &Path| {
        barrier.wait();
        convert_with_progress(&AtomicBool::new(false), input, &output, "mp3", 192, |_| {}).unwrap()
    };
    let results = std::thread::scope(|scope| {
        let x = scope.spawn(|| run(&first));
        let y = scope.spawn(|| run(&second));
        (x.join().unwrap(), y.join().unwrap())
    });
    let paths: std::collections::HashSet<_> = [results.0, results.1].into_iter().collect();
    assert_eq!(paths, [dest.join("song.part (2).mp3"), dest.join("song.part (3).mp3")].into_iter().collect());
    for path in &paths { assert_eq!(probe(path).unwrap().codec.as_deref(), Some("mp3")); }
    assert_eq!(std::fs::read(&output).unwrap(), b"existing");
    assert_eq!(std::fs::read(dest.join("song.part (1).mp3")).unwrap(), b"existing copy");
    assert_eq!(std::fs::read(first).unwrap(), original_a);
    assert_eq!(std::fs::read(second).unwrap(), original_b);
    assert_eq!(std::fs::read_dir(dest).unwrap().count(), 4);
}

#[test]
fn cancellation_after_process_starts_removes_temporary_output() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input.wav");
    let output = dir.path().join("result.mp3");
    wav(&input);
    let cancel = AtomicBool::new(false);
    let mut started = false;
    let result = convert_with_progress(&cancel, &input, &output, "mp3", 192, |_| {
        started = true;
        cancel.store(true, Ordering::SeqCst);
    });
    assert!(started);
    assert!(result.is_err());
    assert!(!output.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn corrupt_input_and_cancel_leave_no_output_or_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("invalid.wav");
    let output = dir.path().join("result.flac");
    std::fs::write(&input, b"not audio").unwrap();
    assert!(convert_with_progress(&AtomicBool::new(false), &input, &output, "flac", 192, |_| {}).is_err());
    wav(&input);
    assert!(convert_with_progress(&AtomicBool::new(true), &input, &output, "flac", 192, |_| {}).is_err());
    assert!(!output.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
