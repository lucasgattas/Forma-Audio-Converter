use std::io::Read;
use std::path::Path;

/// Resolução fixa do envelope: uma amostra de pico a cada 100 ms de áudio.
/// O envelope é depois reduzido para a quantidade de colunas que a interface pedir.
const WINDOW_MS: u32 = 100;
const SAMPLE_RATE: u32 = 4_000;
const SAMPLES_PER_WINDOW: usize = (SAMPLE_RATE / 1000) as usize * WINDOW_MS as usize;
/// Teto de janelas (uma hora de áudio). Acima disso a leitura para, sem travar a fila.
const MAX_WINDOWS: usize = 36_000;
pub const MIN_BUCKETS: u32 = 16;
pub const MAX_BUCKETS: u32 = 512;

/// Escala a amplitude absoluta de 16 bits para 0 a 255 sem truncar o topo.
fn scale_peak(peak: u32) -> u8 {
    let ratio = (peak.min(32_768) as f64) / 32_768.0;
    (ratio * 255.0).round() as u8
}

/// Converte PCM mono s16le em picos por janela, de 0 a 255.
pub fn envelope(pcm: &[u8], samples_per_window: usize) -> Vec<u8> {
    if samples_per_window == 0 {
        return Vec::new();
    }
    let mut peaks = Vec::with_capacity(pcm.len() / 2 / samples_per_window + 1);
    let mut peak = 0u32;
    let mut count = 0usize;
    for chunk in pcm.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]).unsigned_abs() as u32;
        peak = peak.max(sample);
        count += 1;
        if count == samples_per_window {
            peaks.push(scale_peak(peak));
            peak = 0;
            count = 0;
        }
    }
    if count > 0 {
        peaks.push(scale_peak(peak));
    }
    peaks
}

/// Reduz o envelope para o número de colunas pedido, preservando o pico de cada faixa.
pub fn downsample(peaks: &[u8], buckets: usize) -> Vec<u8> {
    if buckets == 0 || peaks.is_empty() {
        return Vec::new();
    }
    if peaks.len() <= buckets {
        return peaks.to_vec();
    }
    let mut out = Vec::with_capacity(buckets);
    for index in 0..buckets {
        let start = index * peaks.len() / buckets;
        let end = ((index + 1) * peaks.len() / buckets).max(start + 1);
        out.push(peaks[start..end.min(peaks.len())].iter().copied().max().unwrap_or(0));
    }
    out
}

/// Normaliza pelo pico do próprio arquivo e aplica raiz quadrada para o envelope
/// ficar legível em trechos baixos, sem inventar silêncio onde há som.
pub fn normalize(peaks: &[u8]) -> Vec<u8> {
    let max = peaks.iter().copied().max().unwrap_or(0);
    if max == 0 {
        return peaks.to_vec();
    }
    let scale = 255.0 / (max as f64);
    peaks
        .iter()
        .map(|value| {
            let scaled = (*value as f64) * scale / 255.0;
            (scaled.sqrt() * 255.0).round().clamp(0.0, 255.0) as u8
        })
        .collect()
}

fn decode(path: &Path) -> Result<Vec<u8>, String> {
    if !path.is_file() {
        return Err("Arquivo de entrada não encontrado.".into());
    }
    let mut child = crate::binary("ffmpeg")?
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(path)
        .args(["-map", "0:a:0", "-ac", "1", "-ar", &SAMPLE_RATE.to_string(), "-f", "s16le", "-"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "Não foi possível iniciar o FFmpeg para desenhar a onda.".to_string())?;

    let mut pcm = Vec::new();
    let limit = MAX_WINDOWS * SAMPLES_PER_WINDOW * 2;
    if let Some(stdout) = child.stdout.as_mut() {
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            if pcm.len() >= limit {
                let _ = child.kill();
                break;
            }
            match stdout.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => pcm.extend_from_slice(&chunk[..read]),
                Err(_) => break,
            }
        }
    }
    let _ = child.wait();
    if pcm.len() < 2 {
        return Err("Não foi possível ler a onda deste arquivo.".into());
    }
    Ok(pcm)
}

/// Picos do arquivo já normalizados e reduzidos, prontos para desenhar.
pub fn peaks(path: &Path, buckets: u32) -> Result<Vec<u8>, String> {
    let buckets = buckets.clamp(MIN_BUCKETS, MAX_BUCKETS) as usize;
    let pcm = decode(path)?;
    let envelope = envelope(&pcm, SAMPLES_PER_WINDOW);
    Ok(normalize(&downsample(&envelope, buckets)))
}

#[tauri::command]
pub fn audio_peaks(path: String, buckets: Option<u32>) -> Result<Vec<u8>, String> {
    peaks(Path::new(&path), buckets.unwrap_or(160))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|value| value.to_le_bytes()).collect()
    }

    #[test]
    fn envelope_keeps_peak_per_window() {
        let data = pcm(&[0, 100, -32768, 50, 0, 0, 0, 0]);
        let peaks = envelope(&data, 4);
        assert_eq!(peaks.len(), 2);
        assert_eq!(peaks[0], 255);
        assert_eq!(peaks[1], 0);
    }

    #[test]
    fn envelope_handles_a_trailing_partial_window() {
        let peaks = envelope(&pcm(&[1000, 2000, 3000]), 2);
        assert_eq!(peaks.len(), 2);
        assert!(peaks[1] > 0);
    }

    #[test]
    fn envelope_ignores_odd_trailing_bytes() {
        let mut data = pcm(&[100, 200, 300]);
        data.push(0x7f);
        assert_eq!(envelope(&data, 2).len(), 2);
    }

    #[test]
    fn downsample_keeps_the_loudest_value_of_each_range() {
        let peaks = vec![1u8, 200, 3, 4, 250, 6, 7, 8];
        // Cada coluna recebe o pico da sua própria faixa, sem repetir o vizinho.
        assert_eq!(downsample(&peaks, 4), vec![200, 4, 250, 8]);
        assert_eq!(downsample(&peaks, 8), peaks);
        assert_eq!(downsample(&peaks, 3).len(), 3);
        assert_eq!(downsample(&[], 4), Vec::<u8>::new());
        assert_eq!(downsample(&peaks, 0), Vec::<u8>::new());
    }

    #[test]
    fn downsample_never_pads_with_gaps() {
        let peaks = vec![10u8, 20, 30, 40, 50, 60, 70];
        for buckets in MIN_BUCKETS as usize..=MAX_BUCKETS as usize {
            let out = downsample(&peaks, buckets.min(peaks.len()));
            assert!(out.iter().all(|value| *value > 0), "bucket vazio em {buckets}");
        }
    }

    #[test]
    fn normalize_uses_the_files_own_peak_and_keeps_silence() {
        let out = normalize(&[64, 128, 255]);
        assert_eq!(out[2], 255);
        assert!(out[0] < out[1] && out[1] < out[2]);
        assert_eq!(normalize(&[0, 0, 0]), vec![0, 0, 0]);
    }

    #[test]
    fn peaks_of_a_missing_file_fails_without_starting_ffmpeg() {
        let error = peaks(Path::new("C:/nao/existe.wav"), 160).unwrap_err();
        assert!(error.contains("não encontrado"));
    }
}
