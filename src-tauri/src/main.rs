#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[allow(dead_code)]
mod bundled_tools;
mod media;
mod waveform;
mod tool_check;
mod folder_scan_core;
mod folder_selection;
#[cfg(test)]
mod folder_scan_tests;

#[cfg(test)]
mod conversion_tests;
#[cfg(test)]
mod destination_tests;

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::{BufRead, BufReader}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, thread, time::Duration};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct ToolAvailability {
    #[serde(flatten)]
    tools: tool_check::ToolsReport,
    // Policy only; the frontend also checks both tool statuses for readiness.
    conversion_allowed: bool,
}

#[tauri::command]
async fn check_tool_availability() -> Result<ToolAvailability, String> {
    let tools = tauri::async_runtime::spawn_blocking(|| {
        #[cfg(feature = "local-installer-test")]
        {
            return tool_check::check_resolved_tools(local_tool("ffmpeg"), local_tool("ffprobe"), Duration::from_secs(5));
        }
        #[cfg(not(feature = "local-installer-test"))]
        tool_check::check_tools()
    })
        .await.map_err(|_| "Tool check failed".to_string())?;
    Ok(ToolAvailability { tools, conversion_allowed: cfg!(debug_assertions) || cfg!(feature = "local-installer-test") })
}

#[derive(Default)]
struct Destination(Mutex<Option<PathBuf>>);

impl Destination {
    fn select(&self, path: &Path) -> Result<PathBuf, String> {
        let path = path.canonicalize().map_err(|_| "Pasta de destino não encontrada.")?;
        if !path.is_dir() { return Err("Pasta de destino inválida.".into()); }
        *self.0.lock().map_err(|_| "Falha ao acessar a pasta de destino.")? = Some(path.clone());
        Ok(path)
    }

    fn path(&self) -> Result<PathBuf, String> {
        let path = self.0.lock().map_err(|_| "Falha ao acessar a pasta de destino.")?.clone().ok_or("Selecione a pasta de destino.")?;
        if !path.is_dir() || path.canonicalize().ok().as_ref() != Some(&path) { return Err("Pasta de destino indisponível.".into()); }
        Ok(path)
    }
}

#[tauri::command]
async fn choose_destination(app: tauri::AppHandle, title: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_title(title).blocking_pick_folder();
        match selected {
            None => Ok(None),
            Some(path) => {
                let path = path.into_path().map_err(|_| "Pasta de destino inválida.")?;
                let selected = app.state::<Destination>().select(&path)?;
                Ok(Some(selected.to_string_lossy().into_owned()))
            }
        }
    }).await.map_err(|_| "Não foi possível selecionar a pasta.".to_string())?
}

#[tauri::command]
fn open_destination(destination: State<'_, Destination>) -> Result<(), String> {
    let path = destination.path()?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Default)]
struct Jobs { next: AtomicU64, entries: Mutex<HashMap<String, Arc<AtomicBool>>> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioInfo { duration: Option<f64>, sample_rate: Option<u32>, channels: Option<u32>, codec: Option<String> }

#[derive(Deserialize)]
struct Probe { streams: Vec<Stream>, format: ProbeFormat }
#[derive(Deserialize)]
struct Stream { codec_name: Option<String>, sample_rate: Option<String>, channels: Option<u32> }
#[derive(Deserialize)]
struct ProbeFormat { duration: Option<String> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress { job_id: String, status: &'static str, progress: Option<f64>, output_path: Option<String>, error: Option<String> }

#[cfg(feature = "local-installer-test")]
fn local_tool(name: &str) -> Result<PathBuf, String> {
    let tool = match name {
        "ffmpeg" => bundled_tools::Tool::Ffmpeg,
        "ffprobe" => bundled_tools::Tool::Ffprobe,
        _ => return Err("Ferramenta inválida.".into()),
    };
    let exe = std::env::current_exe().map_err(|_| "Aplicativo indisponível.")?;
    let dir = exe.parent().ok_or("Pasta do aplicativo indisponível.")?.join("local-ffmpeg");
    bundled_tools::resolve_bundled(&dir, tool).map_err(str::to_string)
}

pub(crate) fn binary(name: &str) -> Result<Command, String> {
    // The development binary deliberately uses PATH. A release needs an audited,
    // bundled FFmpeg and a separate licensing review before this guard is removed.
    #[cfg(feature = "local-installer-test")]
    let mut command = Command::new(local_tool(name)?);
    #[cfg(not(feature = "local-installer-test"))]
    let mut command = {
        if !cfg!(debug_assertions) { return Err("Esta prova técnica não inclui FFmpeg para distribuição.".into()); }
        Command::new(name)
    };
    #[cfg(windows)] command.creation_flags(0x08000000);
    Ok(command)
}

fn probe(path: &Path) -> Result<AudioInfo, String> {
    if !path.is_file() { return Err("Arquivo de entrada não encontrado.".into()); }
    let output = binary("ffprobe")?.args(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "json"])
        .arg(path).output().map_err(|_| "Não foi possível iniciar o FFprobe. Verifique a instalação local.".to_string())?;
    if !output.status.success() { return Err("Não foi possível ler este arquivo de áudio.".into()); }
    let data: Probe = serde_json::from_slice(&output.stdout).map_err(|_| "Resposta inválida do FFprobe.".to_string())?;
    let stream = data.streams.first().ok_or("O arquivo não contém uma faixa de áudio.")?;
    Ok(AudioInfo { duration: data.format.duration.and_then(|x| x.parse::<f64>().ok()).filter(|n| n.is_finite() && *n > 0.0), sample_rate: stream.sample_rate.as_ref().and_then(|x| x.parse().ok()), channels: stream.channels, codec: stream.codec_name.clone() })
}

#[tauri::command]
fn probe_audio(path: String) -> Result<AudioInfo, String> { probe(Path::new(&path)) }

fn cover_count(path: &Path) -> Result<usize, String> {
    let output = binary("ffprobe")?.args(["-v", "error", "-show_entries", "stream_disposition=attached_pic", "-of", "json"]).arg(path).output()
        .map_err(|_| "Não foi possível verificar a capa com o FFprobe.")?;
    if !output.status.success() { return Err("Não foi possível verificar a capa do arquivo.".into()); }
    let data: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_| "Resposta inválida ao verificar a capa.")?;
    let streams = data["streams"].as_array().ok_or("Resposta incompleta ao verificar a capa.")?;
    Ok(streams.iter().filter(|stream| stream["disposition"]["attached_pic"].as_u64() == Some(1)).count())
}

const MAX_OGG_COVER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_OGG_COVER_DIMENSION: u64 = 4096;

fn valid_cover_limits(size: u64, width: u64, height: u64) -> bool {
    (1..=MAX_OGG_COVER_BYTES).contains(&size)
        && (1..=MAX_OGG_COVER_DIMENSION).contains(&width)
        && (1..=MAX_OGG_COVER_DIMENSION).contains(&height)
}

fn ogg_cover(path: &Path) -> Result<(Vec<u8>, u32, u32), String> {
    let error = "Não foi possível preservar a capa JPEG ou PNG dentro dos limites seguros (16 MiB, 4096 × 4096).";
    let info = binary("ffprobe")?.args(["-v", "error", "-show_entries", "stream=index,codec_name,width,height:stream_disposition=attached_pic", "-of", "json"]).arg(path).output().map_err(|_| error)?;
    if !info.status.success() { return Err(error.into()); }
    let info: serde_json::Value = serde_json::from_slice(&info.stdout).map_err(|_| error)?;
    let stream = info["streams"].as_array().and_then(|s| s.iter().find(|s| s["disposition"]["attached_pic"].as_u64() == Some(1))).ok_or(error)?;
    let index = stream["index"].as_u64().ok_or(error)?.to_string();
    let packets = binary("ffprobe")?.args(["-v", "error", "-select_streams", &index, "-read_intervals", "%+#1", "-show_packets", "-show_entries", "packet=size", "-of", "json"]).arg(path).output().map_err(|_| error)?;
    if !packets.status.success() { return Err(error.into()); }
    let packets: serde_json::Value = serde_json::from_slice(&packets.stdout).map_err(|_| error)?;
    let packet_size = packets["packets"].as_array().and_then(|p| p.first()).and_then(|p| p["size"].as_str()).and_then(|s| s.parse::<u64>().ok()).ok_or(error)?;
    let width = stream["width"].as_u64().ok_or(error)?;
    let height = stream["height"].as_u64().ok_or(error)?;
    if !valid_cover_limits(packet_size, width, height) { return Err(error.into()); }
    let (width, height) = (width as u32, height as u32);
    if stream["codec_name"] != "png" && stream["codec_name"] != "mjpeg" { return Err(error.into()); }
    let file = tempfile::NamedTempFile::new().map_err(|_| error)?;
    let status = binary("ffmpeg")?.args(["-v", "error", "-nostdin", "-y", "-i"]).arg(path).args(["-map", "0:v:disp:attached_pic", "-c", "copy", "-frames:v", "1", "-fs", "16777216", "-f", "image2"]).arg(file.path()).status().map_err(|_| error)?;
    let size = file.as_file().metadata().map_err(|_| error)?.len();
    if !status.success() || size != packet_size { return Err(error.into()); }
    let data = std::fs::read(file.path()).map_err(|_| error)?;
    let valid = if stream["codec_name"] == "png" {
        data.starts_with(b"\x89PNG\r\n\x1a\n") && data.ends_with(b"IEND\xaeB`\x82")
    } else {
        data.starts_with(b"\xff\xd8\xff") && data.ends_with(b"\xff\xd9")
    };
    if !valid { return Err(error.into()); }
    Ok((data, width, height))
}

fn picture_comment(data: &[u8], width: u32, height: u32) -> String {
    let mut block = Vec::new();
    let mime = if data.starts_with(b"\x89PNG") { b"image/png".as_slice() } else { b"image/jpeg".as_slice() };
    for value in [3u32, mime.len() as u32] { block.extend(value.to_be_bytes()); }
    block.extend(mime);
    for value in [0u32, width, height, 24, 0, data.len() as u32] { block.extend(value.to_be_bytes()); }
    block.extend(data);
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in block.chunks(3) {
        let n = ((chunk[0] as u32) << 16) | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8) | chunk.get(2).copied().unwrap_or(0) as u32;
        result.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        result.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        result.push(if chunk.len() > 1 { ALPHABET[((n >> 6) & 63) as usize] as char } else { '=' });
        result.push(if chunk.len() > 2 { ALPHABET[(n & 63) as usize] as char } else { '=' });
    }
    result
}

fn send(app: &tauri::AppHandle, id: &str, status: &'static str, progress: Option<f64>, path: Option<String>, error: Option<String>) {
    let _ = app.emit("conversion-progress", Progress { job_id: id.into(), status, progress, output_path: path, error });
}

fn output_settings(format: &str, bitrate: u32) -> Result<(&'static str, &'static str), String> {
    let settings = match format {
        "mp3" => ("libmp3lame", "mp3"),
        "flac" => ("flac", "flac"),
        "wav" => ("pcm_s16le", "wav"),
        "m4a" => ("aac", "mp4"),
        "ogg" => ("libvorbis", "ogg"),
        "opus" => ("libopus", "ogg"),
        _ => return Err("Formato de saída não suportado.".into()),
    };
    if !["flac", "wav"].contains(&format) && !(128..=320).contains(&bitrate) {
        return Err("Taxa de bits inválida.".into());
    }
    Ok(settings)
}

#[derive(Clone, Copy, Default)]
struct ConversionOptions { sample_rate: Option<u32>, channels: Option<u32>, wav_bit_depth: Option<u32>, allow_wav_without_cover: bool }

impl ConversionOptions {
    fn validate(self, format: &str) -> Result<(), String> {
        if self.sample_rate.is_some_and(|n| ![22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000].contains(&n)) { return Err("Taxa de amostragem inválida.".into()); }
        if self.channels.is_some_and(|n| ![1, 2].contains(&n)) { return Err("Número de canais inválido.".into()); }
        if self.wav_bit_depth.is_some_and(|n| ![16, 24].contains(&n)) { return Err("Profundidade WAV inválida.".into()); }
        if self.wav_bit_depth.is_some() && format != "wav" { return Err("Profundidade de bits disponível apenas para WAV.".into()); }
        Ok(())
    }
}

// Tauri camelCase arguments: inputPath, outputDir, format, bitrateKbps,
// sampleRate, channels, wavBitDepth. The last four accept null or omission.
// sampleRate: 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000 Hz;
// channels: 1 or 2; omission preserves the source when the encoder supports it.
// wavBitDepth: 16 or 24, WAV only, defaults to 16. bitrateKbps defaults to 192;
// lossy formats accept integer values from 128 to 320 kbps; FLAC/WAV ignore it.
#[tauri::command]
fn start_conversion(app: tauri::AppHandle, jobs: State<'_, Jobs>, input_path: String, output_dir: String, format: String, bitrate_kbps: Option<u32>, sample_rate: Option<u32>, channels: Option<u32>, wav_bit_depth: Option<u32>, allow_wav_without_cover: Option<bool>) -> Result<String, String> {
    let input = PathBuf::from(input_path);
    if !input.is_file() { return Err("Arquivo de entrada não encontrado.".into()); }
    let bitrate = bitrate_kbps.unwrap_or(192);
    output_settings(&format, bitrate)?;
    let options = ConversionOptions { sample_rate, channels, wav_bit_depth, allow_wav_without_cover: allow_wav_without_cover.unwrap_or(false) };
    options.validate(&format)?;
    let directory = PathBuf::from(output_dir);
    if !directory.is_dir() { return Err("Pasta de destino não encontrada.".into()); }
    let name = input.file_stem().ok_or("Nome de arquivo inválido.")?;
    let mut output_name = name.to_os_string();
    output_name.push(format!(".{format}"));
    let output = directory.join(output_name);

    let id = format!("job-{}", jobs.next.fetch_add(1, Ordering::Relaxed));
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.entries.lock().map_err(|_| "Falha ao acessar a fila.")?.insert(id.clone(), cancel.clone());
    let worker_id = id.clone();
    thread::spawn(move || {
        let result = convert(&app, &worker_id, &cancel, &input, &output, &format, bitrate, options);
        match result {
            Ok(path) => send(&app, &worker_id, "completed", Some(1.0), Some(path.to_string_lossy().into_owned()), None),
            Err(_) if cancel.load(Ordering::SeqCst) => send(&app, &worker_id, "cancelled", None, None, None),
            Err(e) => send(&app, &worker_id, "error", None, None, Some(e)),
        }
        if let Ok(mut entries) = app.state::<Jobs>().entries.lock() { entries.remove(&worker_id); };
    });
    Ok(id)
}

fn convert(app: &tauri::AppHandle, id: &str, cancel: &AtomicBool, input: &Path, output: &Path, format: &str, bitrate: u32, options: ConversionOptions) -> Result<PathBuf, String> {
    convert_advanced(cancel, input, output, format, bitrate, options, |progress| send(app, id, "running", progress, None, None))
}

#[cfg(test)]
fn convert_with_progress(cancel: &AtomicBool, input: &Path, output: &Path, format: &str, bitrate: u32, progress: impl FnMut(Option<f64>)) -> Result<PathBuf, String> {
    convert_advanced(cancel, input, output, format, bitrate, ConversionOptions::default(), progress)
}

fn convert_advanced(cancel: &AtomicBool, input: &Path, output: &Path, format: &str, bitrate: u32, options: ConversionOptions, mut progress: impl FnMut(Option<f64>)) -> Result<PathBuf, String> {
    let (mut codec, muxer) = output_settings(format, bitrate)?;
    options.validate(format)?;
    if format == "wav" && options.wav_bit_depth == Some(24) { codec = "pcm_s24le"; }
    let duration = probe(input)?.duration;
    if cancel.load(Ordering::SeqCst) { return Err("Cancelado.".into()); }
    let covers = cover_count(input)?;
    if covers > 0 && format == "wav" && !options.allow_wav_without_cover {
        return Err("Não é possível preservar a capa neste formato de saída.".into());
    }
    let ogg_picture = if covers > 0 && ["ogg", "opus"].contains(&format) {
        if covers != 1 { return Err("Não é possível preservar múltiplas capas neste formato de saída.".into()); }
        Some(ogg_cover(input)?)
    } else { None };
    // The temporary file lives beside the result, allowing no-clobber publication.
    let mut temporary = tempfile::Builder::new().prefix(".audio-converter-").tempfile_in(output.parent().ok_or("Pasta inválida.")?).map_err(|error| format!("Não foi possível criar o arquivo temporário na pasta de destino: {error}"))?.into_temp_path();
    let metadata_file = if let Some((data, width, height)) = &ogg_picture {
        let mut file = tempfile::NamedTempFile::new().map_err(|_| "Não foi possível criar metadados temporários para a capa.")?;
        use std::io::Write;
        write!(file, ";FFMETADATA1\nMETADATA_BLOCK_PICTURE={}\n", picture_comment(data, *width, *height)).map_err(|_| "Não foi possível gravar metadados temporários para a capa.")?;
        Some(file)
    } else { None };
    let mut command = binary("ffmpeg")?;
    command.args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i"]).arg(input);
    if let Some(file) = &metadata_file { command.args(["-f", "ffmetadata", "-i"]).arg(file.path()); }
    command.args(["-map", "0:a:0", "-map_metadata", "0"]);
    if metadata_file.is_some() { command.args(["-map_metadata", "1"]); }
    if ["mp3", "flac", "m4a"].contains(&format) {
        command.args(["-map", "0:v:disp:attached_pic?", "-c:v", "png", "-disposition:v", "attached_pic"]);
    }
    command.args(["-c:a", codec]);
    if !["flac", "wav"].contains(&format) { command.arg("-b:a").arg(format!("{bitrate}k")); }
    if let Some(rate) = options.sample_rate { command.arg("-ar").arg(rate.to_string()); }
    if let Some(channels) = options.channels { command.arg("-ac").arg(channels.to_string()); }
    command.args(["-progress", "pipe:1", "-nostats", "-f", muxer]).arg(temporary.as_os_str()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| "Não foi possível iniciar o FFmpeg. Verifique a instalação local.".to_string())?;
    let stdout = child.stdout.take().ok_or("Não foi possível acompanhar o progresso.")?;
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || { for line in BufReader::new(stdout).lines().map_while(Result::ok) { if tx.send(line).is_err() { break; } } });
    progress(Some(0.0));
    loop {
        if cancel.load(Ordering::SeqCst) { let _ = child.kill(); let _ = child.wait(); return Err("Cancelado.".into()); }
        while let Ok(line) = rx.try_recv() {
            if let Some(value) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()) {
                progress(duration.map(|d| (value / 1_000_000.0 / d).clamp(0.0, 0.99)));
            }
        }
        if let Some(status) = child.try_wait().map_err(|_| "Falha ao acompanhar o FFmpeg.")? {
            if !status.success() {
                return Err(if covers > 0 { "A conversão falhou ao processar o áudio ou preservar a capa. Verifique os codificadores FFmpeg e o arquivo de entrada." } else { "A conversão falhou. Verifique se o FFmpeg instalado possui o codificador solicitado e se o arquivo de entrada é válido." }.into());
            }
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if cancel.load(Ordering::SeqCst) { return Err("Cancelado.".into()); }
    if temporary.metadata().map_err(|_| "Arquivo de saída indisponível.")?.len() == 0 { return Err("O arquivo convertido está vazio.".into()); }
    if covers > 0 && format != "wav" && cover_count(temporary.as_ref())? != covers { return Err("Não foi possível preservar todas as capas no arquivo convertido.".into()); }
    if format == "wav" && cover_count(temporary.as_ref())? != 0 { return Err("Não foi possível remover a capa do arquivo convertido.".into()); }
    if let Some((data, _, _)) = &ogg_picture {
        if ogg_cover(temporary.as_ref())?.0 != *data { return Err("A capa convertida não corresponde à original.".into()); }
    }
    let stem = output.file_stem().ok_or("Nome de arquivo inválido.")?;
    for number in 0u64.. {
        if cancel.load(Ordering::SeqCst) { return Err("Cancelado.".into()); }
        let candidate = if number == 0 { output.to_path_buf() } else {
            let mut name = stem.to_os_string();
            name.push(format!(" ({number})"));
            if let Some(extension) = output.extension() { name.push("."); name.push(extension); }
            output.with_file_name(name)
        };
        match temporary.persist_noclobber(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => temporary = error.path,
            Err(_) => return Err("Não foi possível salvar o resultado. Verifique as permissões da pasta.".into()),
        }
    }
    Err("Não foi possível encontrar um nome disponível.".into())
}

#[tauri::command]
fn cancel_conversion(jobs: State<'_, Jobs>, job_id: String) -> Result<(), String> {
    let entries = jobs.entries.lock().map_err(|_| "Falha ao acessar a fila.")?;
    let cancel = entries.get(&job_id).ok_or("Conversão não encontrada ou já encerrada.")?;
    cancel.store(true, Ordering::SeqCst);
    Ok(())
}

fn main() {
    tauri::Builder::default().manage(Jobs::default()).manage(Destination::default()).manage(media::Playable::default()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init()).register_asynchronous_uri_scheme_protocol("forma-media", |context, request, responder| media::handle(context.app_handle(), request, responder)).invoke_handler(tauri::generate_handler![check_tool_availability, probe_audio, start_conversion, cancel_conversion, choose_destination, open_destination, media::set_playable_files,
            waveform::audio_peaks, folder_selection::choose_input_folder]).run(tauri::generate_context!()).expect("error while running application");
}
