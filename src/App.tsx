import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { captureState, defaultStorage, readStoredState, saveState, type FormatMemory } from './persistence';
import { Waveform, formatClock } from './Waveform';
import './queue.css';
import { readLanguage, translate, type Language } from './languages';

export { readLanguage, type Language } from './languages';
export const copy = {
  en: { files: 'Your files' },
  'pt-BR': { files: 'Seus arquivos' },
};
const translations: Record<string, string> = {
  "SEU SOM, NA FORMA CERTA": "YOUR SOUND, IN THE RIGHT FORMAT",
  "Áudio, sem ": "Audio, without ",
  "complicação.": "compromise.",
  "Converta seus arquivos com precisão, no seu computador.": "Convert your files with precision, on your own computer.",
  "CONVERSOR DE ÁUDIO": "AUDIO CONVERTER",
  "Conversor de áudio": "Audio converter",
  "Seus arquivos": "Your files",
  "ORIGEM": "SOURCE",
  "arquivo selecionado": "file selected",
  "arquivos selecionados": "files selected",
  "Arraste ou selecione mais arquivos": "Drag or select more files",
  "ADICIONAR": "ADD",
  "Selecione seus áudios": "Select your audio",
  "Arraste ou escolha um ou mais arquivos de áudio": "Drag or choose one or more audio files",
  "ÁUDIO": "AUDIO",
  "ARQUIVOS": "FILES",
  "Taxa desconhecida": "Unknown sample rate",
  "Estéreo": "Stereo",
  "canais": "channels",
  "Arquivos selecionados": "Selected files",
  "de": "of",
  "processados": "processed",
  "Limpar lista": "Clear list",
  "Aguardando": "Pending",
  "Convertendo": "Converting",
  "Concluído": "Completed",
  "Cancelado": "Cancelled",
  "Erro": "Error",
  "Remover": "Remove",
  "da lista": "from list",
  "Seu áudio continua sendo seu.": "Your audio stays yours.",
  "O processamento acontece localmente, sem envio para a nuvem.": "Processing happens locally, without uploading to the cloud.",
  "Escolha a saída": "Choose output",
  "CONFIGURAÇÃO": "SETTINGS",
  "FORMATO": "FORMAT",
  "ESCOLHA UM": "CHOOSE ONE",
  "Formato de saída": "Output format",
  "QUALIDADE": "QUALITY",
  "SEM PERDAS": "LOSSLESS",
  "Taxa de bits": "Bitrate",
  "Personalizado": "Custom",
  "Tamanho estimado": "Estimated size",
  "Indisponível": "Unavailable",
  "Total estimado": "Estimated total",
  "Subtotal estimado": "Estimated subtotal",
  "Estimativas aproximadas; o tamanho final pode variar com o codificador e o overhead do arquivo.": "Approximate estimates; actual size may vary with the encoder and file overhead.",
  "Perfil de qualidade": "Quality profile",
  "MENOR ARQUIVO": "SMALLER FILE",
  "MAIOR QUALIDADE": "HIGHER QUALITY",
  "A conversão sem perdas não recupera perdas presentes no áudio de origem. Alterar taxa ou canais pode modificar o áudio.": "Lossless conversion cannot recover quality already lost in the source. Changing sample rate or channels may alter the audio.",
  "OPÇÕES AVANÇADAS": "ADVANCED OPTIONS",
  "Taxa de amostragem": "Sample rate",
  "Manter da origem": "Keep source",
  "Canais": "Channels",
  "Profundidade PCM": "PCM depth",
  "DESTINO": "DESTINATION",
  "ONDE SALVAR": "SAVE TO",
  "Escolher pasta de destino": "Choose destination folder",
  "Cancelando lote...": "Cancelling batch...",
  "Cancelar lote": "Cancel batch",
  "CONVERSÃO LOCAL": "LOCAL CONVERSION",
  "SOM EM FOCO": "SOUND IN FOCUS",
  "PROJETADO PARA OUVIR MAIS.": "MADE FOR LISTENING.",
  "FORMA AUDIO": "FORMA AUDIO",
  "PROTÓTIPO": "PROTOTYPE",
  "Limpar lista?": "Clear list?",
  "Os arquivos serão removidos apenas da lista; nada será apagado do computador.": "Files will only be removed from the list; nothing will be deleted from your computer.",
  "Cancelar": "Cancel",
  "PROCESSAMENTO LOCAL": "LOCAL PROCESSING",
  "VERSÃO BETA": "BETA VERSION",
  "Idioma": "Language",
  "Compatibilidade ampla": "Wide compatibility",
  "Sem perdas": "Lossless",
  "Áudio PCM": "PCM audio",
  "Áudio AAC": "AAC audio",
  "Opus em Ogg": "Opus in Ogg",
  "Duração desconhecida": "Unknown duration",
  "Arquivos de áudio": "Audio files",
  "Selecione a pasta de destino": "Select destination folder",
  "Não foi possível abrir a pasta": "Could not open folder",
  "Abrir pasta": "Open folder",
  "Abrir pasta de destino": "Open destination folder",
  "Arrastar arquivos indisponível": "File drag and drop unavailable",
  "Não foi possível acompanhar a conversão": "Could not monitor conversion",
  "Não foi possível solicitar o cancelamento": "Could not request cancellation"
};

type Format = 'mp3' | 'flac' | 'wav' | 'm4a' | 'ogg' | 'opus';
const formats: { id: Format; description: string }[] = [
  { id: 'mp3', description: 'Compatibilidade ampla' },
  { id: 'flac', description: 'Sem perdas' },
  { id: 'wav', description: 'Áudio PCM' },
  { id: 'm4a', description: 'Áudio AAC' },
  { id: 'ogg', description: 'Ogg Vorbis' },
  { id: 'opus', description: 'Opus em Ogg' },
];
type Info = { duration: number | null; sampleRate: number | null; channels: number | null; codec: string | null };
type ToolResult = { status: 'available' | 'not_found' | 'failed' | 'timed_out'; version: string | null };
type ToolsReport = { ffmpeg: ToolResult; ffprobe: ToolResult; conversion_allowed: boolean };
type Progress = { jobId: string; status: 'running' | 'completed' | 'cancelled' | 'error'; progress: number | null; outputPath: string | null; error: string | null };
type Item = { path: string; info: Info; status: 'pending' | Progress['status']; progress: number | null; outputPath: string | null; error: string | null };

export const qualityProfiles = [
  { bitrate: 128, en: 'Compact', pt: 'Compacto' },
  { bitrate: 192, en: 'Standard', pt: 'Padrão' },
  { bitrate: 256, en: 'High', pt: 'Alto' },
  { bitrate: 320, en: 'Maximum', pt: 'Máximo' },
] as const;

export const sampleRates = [22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000];

export function inputPathKey(path: string) {
  const plain = path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(plain) ? plain.replace(/\//g, '\\').toLowerCase() : plain;
}

export async function validateInputs<T>(paths: string[], probe: (path: string) => Promise<T>) {
  const accepted: string[] = [];
  const metadata: Record<string, T> = {};
  let rejected = 0;
  for (const path of new Set(paths)) {
    if (!/\.(wav|mp3|flac|m4a|aac|ogg|opus|aiff|aif|wma)$/i.test(path)) { rejected++; continue; }
    try { metadata[path] = await probe(path); accepted.push(path); } catch { rejected++; }
  }
  return { accepted, rejected, metadata };
}

export function estimateBytes(info: Pick<Info, 'duration' | 'sampleRate' | 'channels'>, format: Format, bitrate: number, sampleRate: number | null, channels: number | null, depth: 16 | 24): number | null {
  if (info.duration == null || !Number.isFinite(info.duration) || info.duration <= 0 || format === 'flac') return null;
  if (format !== 'wav') return info.duration * bitrate * 1000 / 8;
  const rate = sampleRate ?? info.sampleRate;
  const count = channels ?? info.channels;
  if (!rate || !count || !Number.isFinite(rate) || !Number.isFinite(count) || rate <= 0 || count <= 0) return null;
  return info.duration * rate * count * depth / 8;
}

export function summarizeEstimates(estimates: (number | null)[]) {
  const known = estimates.filter((value): value is number => value !== null);
  return { bytes: known.length ? known.reduce((sum, value) => sum + value, 0) : null, unknown: estimates.length - known.length };
}

const formatBytes = (bytes: number, language: Language) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(bytes / 1000000)} MB`;

export function retryIndices(items: { status: string }[]) {
  return items.flatMap((item, index) => item.status === 'completed' ? [] : [index]);
}

export function conversionOptions(format: Format, bitrate: number, sampleRate: number | null, channels: number | null, wavBitDepth: 16 | 24) {
  return { bitrateKbps: format === 'flac' || format === 'wav' ? null : bitrate, sampleRate, channels, wavBitDepth: format === 'wav' ? wavBitDepth : null };
}

export function createBatchRunner(options: { start: (path: string) => Promise<string>; cancel: (id: string) => Promise<unknown>; update: (index: number, event: Omit<Progress, 'jobId'>) => void; onCancelError?: (error: unknown) => void; openAfter?: () => Promise<unknown>; onOpenError?: (error: unknown) => void }) {
  let stopped = false;
  let succeeded = false;
  let active = '';
  let index = -1;
  let finish: (() => void) | undefined;
  let terminal = false;
  const buffered = new Map<string, Progress>();
  const onProgress = (event: Progress) => {
    if (event.jobId !== active || index < 0) { buffered.set(event.jobId, event); return; }
    if (terminal) return;
    options.update(index, event);
    if (event.status !== 'running') { if (event.status === 'completed') succeeded = true; if (event.status === 'cancelled') stopped = true; terminal = true; finish?.(); }
  };
  const requestCancel = async () => {
    stopped = true;
    if (active && !terminal) {
      try { await options.cancel(active); } catch (error) { options.onCancelError?.(error); }
    }
  };
  const run = async (paths: string[]) => {
    for (index = 0; index < paths.length; index++) {
      if (stopped) break;
      active = ''; terminal = false;
      options.update(index, { status: 'running', progress: null, outputPath: null, error: null });
      try {
        const id = await options.start(paths[index]);
        active = id;
        const completed = new Promise<void>(resolve => { finish = resolve; });
        const early = buffered.get(id);
        buffered.clear();
        if (early) onProgress(early);
        if (stopped && !terminal) await requestCancel();
        await completed;
      } catch (error) {
        options.update(index, { status: 'error', progress: null, outputPath: null, error: message(error) });
      } finally { active = ''; finish = undefined; }
    }
    if (stopped) for (; index < paths.length; index++) options.update(index, { status: 'cancelled', progress: null, outputPath: null, error: null });
    if (!stopped && succeeded && options.openAfter) {
      try { await options.openAfter(); } catch (error) { options.onOpenError?.(error); }
    }
  };
  return { run, onProgress, cancel: requestCancel };
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />, folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />,
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />, audio: <><path d="M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4" /></>,
    check: <path d="m5 12 4 4L19 6" />, close: <path d="m6 6 12 12M18 6 6 18" />,
    play: <path d="M9 5.5v13l10-6.5z" fill="currentColor" strokeWidth="1.2" />, pause: <><path d="M9.5 5.5v13" /><path d="M14.5 5.5v13" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// One reusable, app-styled switch: native input kept for semantics/a11y, custom track+thumb for the palette.
function Toggle({ id, checked, disabled, onChange, label }: { id: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: ReactNode }) {
  return <label className="toggle" htmlFor={id}>
    <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
    <span className="toggle-label">{label}</span>
  </label>;
}

export function displayDestination(path: string) {
  const drive = /^\\\\\?\\([a-zA-Z]:\\.*)$/.exec(path);
  const unc = /^\\\\\?\\UNC\\([^\\]+)\\([^\\]+)(.*)$/i.exec(path);
  const ordinary = drive ? drive[1] : unc ? `\\\\${unc[1]}\\${unc[2]}${unc[3]}` : null;
  if (!ordinary || ordinary.includes('/') || ordinary.split('\\').some((part, i, parts) =>
    (part === '' && i > 1 && i < parts.length - 1) || part === '.' || part === '..' || /[. ]$/.test(part) ||
    /[<>"|?*\x00-\x1f]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return path;
  return ordinary;
}

const filename = (path: string) => path.split(/[\\/]/).pop() || path;
const describeDuration = (seconds: number | null) => seconds == null ? 'Duração desconhecida' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function App() {
  const [language, setLanguage] = useState<Language>(() => { try { return readLanguage(localStorage.getItem('forma-language')); } catch { return 'en'; } });
  const t = (pt: string) => language === 'en' ? (translations[pt] ?? translate(language, pt)) : translate(language, pt);
  useEffect(() => { document.documentElement.lang = language; try { localStorage.setItem('forma-language', language); } catch { /* Storage may be unavailable. */ } }, [language]);
  const storage = useRef(defaultStorage());
  const [restored] = useState(() => readStoredState(storage.current, { formats: formats.map(entry => entry.id), sampleRates }));
  const [items, setItems] = useState<Item[]>(() => restored.queue.map(entry => ({ ...entry, status: 'pending' as const, progress: null, outputPath: null, error: null })));
  /** Detalhes técnicos da faixa, na mesma linha do nome, para qualquer quantidade de arquivos. */
  const trackMeta = (info: Info | null | undefined) => {
    if (!info) return '';
    const parts: string[] = [];
    if (info.duration != null) parts.push(describeDuration(info.duration));
    if (info.sampleRate) parts.push(`${(info.sampleRate / 1000).toFixed(1)} kHz`);
    if (info.channels === 2) parts.push(t('Estéreo'));
    else if (info.channels === 1) parts.push('Mono');
    else if (info.channels) parts.push(`${info.channels} ${t('canais')}`);
    return parts.join(' · ');
  };

  const info = items.length === 1 ? items[0].info : null;

  const [dir, setDir] = useState(restored.dir);
  const [format, setFormat] = useState<Format>(restored.format as Format);
  const [bitrate, setBitrate] = useState(restored.active.bitrate);
  const [sampleRate, setSampleRate] = useState<number | null>(restored.active.sampleRate);
  const [channels, setChannels] = useState<number | null>(restored.active.channels);
  const [wavBitDepth, setWavBitDepth] = useState<16 | 24>(restored.active.wavBitDepth);
  const [allowWavWithoutCover, setAllowWavWithoutCover] = useState(restored.allowWavWithoutCover);
  const [openAfterBatch, setOpenAfterBatch] = useState(restored.openFolder);

  // Cada formato lembra os próprios ajustes: trocar de formato devolve o que já estava escolhido nele.
  const memory = useRef<Record<string, FormatMemory>>({ ...restored.perFormat });
  const previousFormat = useRef<Format>(restored.format as Format);
  useEffect(() => {
    const previous = previousFormat.current;
    if (previous === format) return;
    previousFormat.current = format;
    memory.current[previous] = { bitrate, sampleRate, channels, wavBitDepth };
    const saved = memory.current[format];
    if (!saved) return;
    setBitrate(saved.bitrate); setSampleRate(saved.sampleRate); setChannels(saved.channels); setWavBitDepth(saved.wavBitDepth);
  }, [format, bitrate, sampleRate, channels, wavBitDepth]);

  // Grava com atraso curto para não escrever a cada tecla, e nunca durante a conversão.
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = captureState({
        format, dir, openFolder: openAfterBatch, allowWavWithoutCover,
        memory: memory.current,
        active: { bitrate, sampleRate, channels, wavBitDepth },
        queue: items.map(item => ({ path: item.path, info: item.info })),
        formats: formats.map(entry => entry.id),
        sampleRates,
      });
      saveState(storage.current, state);
    }, 400);
    return () => clearTimeout(timer);
  }, [format, dir, openAfterBatch, allowWavWithoutCover, bitrate, sampleRate, channels, wavBitDepth, items]);

  // Mini player: o backend só entrega à interface os arquivos que estão na fila (allowlist).
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState('');
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [position, setPosition] = useState(0);
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const peaksInFlight = useRef(new Set<string>());

  useEffect(() => {
    const element = new Audio();
    element.preload = 'metadata';
    const stop = () => setPlaying(null);
    const sync = () => setPosition(element.currentTime);
    element.addEventListener('ended', stop);
    element.addEventListener('error', stop);
    element.addEventListener('timeupdate', sync);
    element.addEventListener('seeked', sync);
    player.current = element;
    return () => {
      element.pause();
      element.removeEventListener('ended', stop);
      element.removeEventListener('error', stop);
      element.removeEventListener('timeupdate', sync);
      element.removeEventListener('seeked', sync);
      player.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pending = items.filter(item => Boolean(item.info) && !(inputPathKey(item.path) in peaksRef.current) && !peaksInFlight.current.has(inputPathKey(item.path)));
    if (pending.length === 0) return;
    void (async () => {
      for (const item of pending) {
        const key = inputPathKey(item.path);
        peaksInFlight.current.add(key);
        try {
          const values = await invoke<number[]>('audio_peaks', { path: item.path, buckets: 180 });
          if (!cancelled && Array.isArray(values) && values.length > 0) {
            setPeaks(previous => ({ ...previous, [key]: values }));
          }
        } catch {
          // Sem onda o item continua utilizável; só não desenha o envelope.
        } finally {
          peaksInFlight.current.delete(key);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items]);

  useEffect(() => {
    const paths = items.map(item => item.path);
    setPlayerError('');
    const timer = setTimeout(() => { invoke('set_playable_files', { paths }).catch(() => undefined); }, 200);
    return () => clearTimeout(timer);
  }, [items]);

  async function togglePlay(item: Item, startAt = 0) {
    const element = player.current;
    if (!element) return;
    const key = inputPathKey(item.path);
    setPlayerError('');
    if (playing === key) {
      if (startAt > 0) {
        element.currentTime = startAt;
        setPosition(startAt);
        return;
      }
      element.pause();
      setPlaying(null);
      return;
    }
    element.src = `http://forma-media.localhost/?p=${encodeURIComponent(item.path)}`;
    try {
      await element.play();
      if (startAt > 0) {
        element.currentTime = startAt;
        setPosition(startAt);
      } else {
        setPosition(0);
      }
      setPlaying(key);
    } catch {
      setPlaying(null);
      setPlayerError(t('Não foi possível reproduzir este arquivo.'));
    }
  }

  /** Clicar na onda toca a partir daquele ponto; sem duração confiável, ignora. */
  function seek(item: Item, ratio: number) {
    const duration = item.info?.duration ?? 0;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const target = Math.max(0, Math.min(duration - 0.05, ratio * duration));
    const key = inputPathKey(item.path);
    if (playing === key) {
      const element = player.current;
      if (!element) return;
      element.currentTime = target;
      setPosition(target);
      return;
    }
    void togglePlay(item, target);
  }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [listenerReady, setListenerReady] = useState(false);
  const [tools, setTools] = useState<ToolsReport | null>(null);
  const [toolState, setToolState] = useState<'loading' | 'ready' | 'error'>('loading');
  const toolRequest = useRef(0);
  async function checkTools() {
    const request = ++toolRequest.current;
    setToolState('loading'); setTools(null);
    try {
      const report = await invoke<ToolsReport>('check_tool_availability');
      if (request === toolRequest.current) { setTools(report); setToolState('ready'); }
    } catch {
      if (request === toolRequest.current) setToolState('error');
    }
  }
  useEffect(() => { void checkTools(); return () => { toolRequest.current++; }; }, []);
  const toolsReady = toolState === 'ready' && tools?.conversion_allowed === true && tools.ffmpeg.status === 'available' && tools.ffprobe.status === 'available';
  const runner = useRef<ReturnType<typeof createBatchRunner> | null>(null);
  const running = busy;
  const [confirmClear, setConfirmClear] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const card = useRef<HTMLButtonElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);

  async function addInputs(paths: string[]) {
    if (locked.current || !toolsReady) return;
    locked.current = true; setAdding(true);
    try {
      const result = await validateInputs(paths, path => invoke<Info>('probe_audio', { path }));
      setItems(previous => {
        const existing = new Set(previous.map(item => inputPathKey(item.path)));
        const additions = result.accepted.filter(path => { const key = inputPathKey(path); if (existing.has(key)) return false; existing.add(key); return true; });
        return [...previous, ...additions.map(path => ({ path, info: result.metadata[path], status: 'pending' as const, progress: null, outputPath: null, error: null }))];
      });

      setError(result.rejected ? `${result.rejected} ${t('item(ns) não puderam ser adicionados. Verifique o formato, se são arquivos de áudio e se o FFprobe está disponível.')}` : '');
    } finally { locked.current = false; setAdding(false); }
  }
  const addRef = useRef(addInputs);
  addRef.current = addInputs;
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'leave') { setDragging(false); return; }
      const rect = card.current?.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const x = payload.position.x / scale, y = payload.position.y / scale;
      const inside = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      setDragging(inside && !locked.current);
      if (payload.type === 'drop') { setDragging(false); if (inside && !locked.current) void addRef.current(payload.paths); }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; })
      .catch(e => setError(`${t("Arrastar arquivos indisponível")}: ${t(message(e))}`));
    return () => { disposed = true; stop?.(); };
  }, []);
  useEffect(() => { if (confirmClear) dialog.current?.showModal(); }, [confirmClear]);
  const configKey = JSON.stringify([dir, format, conversionOptions(format, bitrate, sampleRate, channels, wavBitDepth), format === 'wav' && allowWavWithoutCover]);
  const previousConfig = useRef(configKey);
  useEffect(() => {
    if (previousConfig.current !== configKey) {
      previousConfig.current = configKey;
      setItems(previous => previous.map(item => ({ ...item, status: 'pending', progress: null, outputPath: null, error: null })));
    }
  }, [configKey]);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    listen<Progress>('conversion-progress', ({ payload }) => runner.current?.onProgress(payload))
      .then(unlisten => { if (disposed) unlisten(); else { stop = unlisten; setListenerReady(true); } })
      .catch(e => setError(`${t("Não foi possível acompanhar a conversão")}: ${t(message(e))}`));
    return () => { disposed = true; stop?.(); };
  }, []);

  async function chooseInput() {
    if (locked.current || !toolsReady) return;
    try {
      const selected = await open({ multiple: true, directory: false, filters: [{ name: t("Arquivos de áudio"), extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'wma'] }] });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (!paths.length) return;
      await addInputs(paths);
    } catch (e) { setError(t(message(e))); }
  }

  async function chooseDirectory() {
    try {
      const selected = await invoke<string | null>('choose_destination', { title: t("Selecione a pasta de destino") });
      if (typeof selected === 'string') { setDir(selected); setError(''); }
    } catch (e) { setError(t(message(e))); }
  }

  async function chooseInputFolder() {
    if (locked.current || !toolsReady) return;
    locked.current = true; setAdding(true);
    try {
      const paths = await invoke<string[] | null>('choose_input_folder', { title: t('Selecione a pasta de áudio') });
      if (paths === null) return;
      if (!paths.length) { setError(t('Nenhum arquivo de áudio compatível nesta pasta.')); return; }
      locked.current = false;
      await addInputs(paths);
    } catch (e) { setError(`${t('Não foi possível ler a pasta')}: ${t(message(e))}`); }
    finally { locked.current = false; setAdding(false); }
  }

  async function openDestination() {
    if (!dir) return;
    try { await invoke('open_destination'); } catch (e) { setError(`${t('Não foi possível abrir a pasta')}: ${t(message(e))}`); }
  }

  async function convert() {
    setPlayerError('');
    if (!toolsReady || !items.length || !dir || running || !listenerReady || runner.current || locked.current) return;
    const indices = retryIndices(items);
    if (!indices.length) return;
    locked.current = true;
    setError(''); setBusy(true); setCancelling(false);
    setItems(previous => previous.map(item => item.status === 'completed' ? item : ({ ...item, status: 'pending', progress: null, outputPath: null, error: null })));
    const batch = createBatchRunner({
      start: inputPath => invoke<string>('start_conversion', { inputPath, outputDir: dir, format, ...conversionOptions(format, bitrate, sampleRate, channels, wavBitDepth), allowWavWithoutCover: format === 'wav' && allowWavWithoutCover }),
      cancel: jobId => invoke('cancel_conversion', { jobId }),
      update: (index, event) => setItems(previous => previous.map((item, i) => i === indices[index] ? { ...item, ...event } : item)),
      onCancelError: e => setError(`${t("Não foi possível solicitar o cancelamento")}: ${t(message(e))}`),
      openAfter: openAfterBatch ? () => invoke('open_destination') : undefined,
      onOpenError: e => setError(`${t('Não foi possível abrir a pasta')}: ${t(message(e))}`),
    });
    runner.current = batch;
    try { await batch.run(indices.map(index => items[index].path)); }
    finally { runner.current = null; locked.current = false; setBusy(false); setCancelling(false); }
  }

  function cancel() {
    if (!runner.current || cancelling) return;
    setCancelling(true);
    void runner.current.cancel();
  }

  const completed = items.filter(item => item.status === 'completed' || item.status === 'error' || item.status === 'cancelled').length;
  const estimates = items.map(item => estimateBytes(item.info, format, bitrate, sampleRate, channels, wavBitDepth));
  const total = summarizeEstimates(estimates);

  return <div className="shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Icon name="audio" size={21} /></div><div><strong>forma<span>.</span></strong><small>{t('CONVERSOR DE ÁUDIO')}</small></div></div><div className="header-right"><span className="status-dot" /> {t('PROCESSAMENTO LOCAL')} <span className="header-divider" /> <span className="version">{t('VERSÃO BETA')} {__APP_VERSION__}</span></div><label className="language-selector"><span className="sr-only">{t('Idioma')}</span><select aria-label={t('Idioma')} value={language} onChange={event => setLanguage(readLanguage(event.target.value))}><option value="en">English</option><option value="pt-BR">Português (Brasil)</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option></select></label></header>
    <main>
      <div className={`intro ${items.length ? 'is-compact' : ''}`}><div><div className="eyebrow"><span className="line" /> {t("SEU SOM, NA FORMA CERTA")}</div><h1>{t("Áudio, sem ")}<em>{t("complicação.")}</em></h1>{!items.length && <p>{t("Converta seus arquivos com precisão, no seu computador.")}</p>}</div><div className="intro-index"><span>01 / 01</span><small>{t("CONVERSOR DE ÁUDIO")}</small></div></div>
      <section className="workspace" aria-label={t("Conversor de áudio")}>
        <div className="panel panel-files"><div className="section-heading"><div><span className="step">01</span><h2>{t("Seus arquivos")}</h2></div><span className="micro">{t("ORIGEM")}</span></div>
          <button ref={card} className={`file-card ${items.length ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`} onClick={chooseInput} disabled={running || adding || !toolsReady}>
            {items.length ? <><div className="file-icon"><Icon name="audio" size={26} /></div><div className="file-details"><strong>{items.length} {items.length === 1 ? t("arquivo selecionado") : t("arquivos selecionados")}</strong><span>{t("Arraste ou selecione mais arquivos")}</span></div><span className="change-file">{t("ADICIONAR")} <Icon name="arrow" size={16} /></span></> : <><span className="upload-icon"><Icon name="plus" size={24} /></span><strong>{t("Selecione seus áudios")}</strong><span>{t("Arraste ou escolha um ou mais arquivos de áudio")}</span><span className="file-pill">{t("ÁUDIO")} <span> / </span> {t("ARQUIVOS")}</span></>}
          </button>
          <span className="hint-wrap"><button type="button" className="add-folder" onClick={chooseInputFolder} aria-describedby="folder-scope" disabled={running || adding || !toolsReady}><Icon name="folder" size={16} /> {t('Adicionar pasta')}</button><span className="hint-card" id="folder-scope" role="tooltip">{t('Subpastas não são incluídas; links simbólicos são ignorados.')}</span></span>
          {items.length > 0 && <div className="batch-list" aria-label={t("Arquivos selecionados")} aria-live="polite"><div className="batch-summary"><span>{completed} {t('de')} {items.length} {t('processados')}</span> <button ref={clearButton} className="queue-clear" disabled={running || adding} onClick={() => setConfirmClear(true)}><Icon name="close" size={12} /> {t("Limpar lista")}</button></div>{items.map((item, index) => {
            const percent = item.progress == null ? null : Math.max(0, Math.min(100, Math.round(item.progress * 100)));
            const label = item.status === 'pending' ? t("Aguardando") : item.status === 'running' ? `${t('Convertendo')}${percent == null ? '' : ` · ${percent}%`}` : item.status === 'completed' ? t("Concluído") : item.status === 'cancelled' ? t("Cancelado") : t("Erro");
            return <div className="batch-item" key={`${item.path}-${index}`}><div className="batch-item-head"><button type="button" className="play-button" aria-label={`${playing === inputPathKey(item.path) ? t('Pausar') : t('Reproduzir')} ${filename(item.path)}`} onClick={() => { void togglePlay(item); }}><Icon name={playing === inputPathKey(item.path) ? 'pause' : 'play'} size={12} /></button><strong title={item.path}>{filename(item.path)}</strong>{trackMeta(item.info) && <small className="track-meta">{trackMeta(item.info)}</small>}<span>{label}</span></div><small className="estimate-item">{t("Tamanho estimado")}: {estimates[index] === null ? t("Indisponível") : `≈ ${formatBytes(estimates[index]!, language)}`}</small><div className="batch-item-actions"><button className="queue-remove" aria-label={`${t('Remover')} ${filename(item.path)} ${t('da lista')}`} disabled={running || adding} onClick={() => { if (!locked.current) setItems(previous => previous.filter((_, i) => i !== index)); }}><Icon name="close" size={13} /> {t("Remover")}</button><Waveform peaks={peaks[inputPathKey(item.path)] ?? null} playing={playing === inputPathKey(item.path)} progress={playing === inputPathKey(item.path) && (item.info?.duration ?? 0) > 0 ? position / (item.info?.duration ?? 1) : 0} label={`${t('Posição em')} ${filename(item.path)}`} onSeek={ratio => seek(item, ratio)} /><small className="wave-clock" aria-hidden={playing !== inputPathKey(item.path)}>{(playing === inputPathKey(item.path) && (item.info?.duration ?? 0) > 0) ? `${formatClock(position)} / ${formatClock(item.info!.duration!)}` : ''}</small></div>{item.status === 'running' && <div className={`progress-track ${percent == null ? 'indeterminate' : ''}`}><div style={percent == null ? undefined : { width: `${percent}%` }} /></div>}{item.error && <small className="batch-error">{t(item.error)}</small>}{item.outputPath && <small title={item.outputPath}>{item.outputPath}</small>}</div>;
          })}{items.length > 1 && <div className="estimate-total">{t(total.unknown && total.bytes !== null ? 'Subtotal estimado' : 'Total estimado')}: {total.bytes === null ? t('Indisponível') : `≈ ${formatBytes(total.bytes, language)}`}{total.unknown > 0 && ` · ${total.unknown} ${t('sem estimativa')}`}</div>}<p className="estimate-note">{t('Estimativas aproximadas; o tamanho final pode variar com o codificador e o overhead do arquivo.')}</p></div>}
          {playerError && <div className="alert alert-player" role="alert">{playerError}</div>}
          <div className="privacy"><span className="privacy-icon">✳</span><span><strong>{t("Seu áudio continua sendo seu.")}</strong><br />{t("O processamento acontece localmente, sem envio para a nuvem.")}</span></div>
        </div>
        <div className="panel-settings">
        <div className="panel panel-format"><div className="section-heading"><div><span className="step">02</span><h2>{t("Escolha a saída")}</h2></div><span className="micro">{t("CONFIGURAÇÃO")}</span></div>
          <div className="panel-scroll">
          <div className="label-row"><label>{t("FORMATO")}</label><span>{t("ESCOLHA UM")}</span></div><div className="formats" role="group" aria-label={t("Formato de saída")}>{formats.map(({ id, description }) => <button key={id} onClick={() => setFormat(id)} disabled={!!running} aria-pressed={format === id} className={`format ${format === id ? 'selected' : ''}`}><span className="format-top"><strong>{id.toUpperCase()}</strong><span className="radio"><span /></span></span><small>{t(description)}</small></button>)}</div>
          <div className="settings"><div className="setting-head"><span>{t("QUALIDADE")}</span><span className="accent">{format !== 'flac' && format !== 'wav' ? `${bitrate} KBPS${qualityProfiles.some(profile => profile.bitrate === bitrate) ? '' : ` · ${t('Personalizado')}`}` : t("SEM PERDAS")}</span></div>{format !== 'flac' && format !== 'wav' ? <><div className="quality-profiles" role="group" aria-label={t("Perfil de qualidade")}>{qualityProfiles.map(profile => <button type="button" key={profile.bitrate} disabled={running} aria-pressed={bitrate === profile.bitrate} onClick={() => setBitrate(profile.bitrate)}><span>{t(profile.pt)}</span><small>{profile.bitrate} kbps</small></button>)}</div><label htmlFor="bitrate" className="sr-only">{t("Taxa de bits")}</label><input id="bitrate" type="range" min="128" max="320" step="1" value={bitrate} onChange={e => setBitrate(Number(e.target.value))} disabled={!!running} /><div className="range-labels"><span>{t("MENOR ARQUIVO")}</span><span>{t("MAIOR QUALIDADE")}</span></div></> : <p className="format-note">{t("A conversão sem perdas não recupera perdas presentes no áudio de origem. Alterar taxa ou canais pode modificar o áudio.")}</p>}</div>
          </div>
        </div>
        <div className="panel panel-output"><div className="section-heading"><div><span className="step">03</span><h2>{t('Ajustes e destino')}</h2></div></div>
          <div className="panel-scroll">
          <div className="advanced-settings">
            <div className="setting-head"><span>{t("OPÇÕES AVANÇADAS")}</span></div>
            <div className="advanced-grid">
              <label htmlFor="sample-rate">{t("Taxa de amostragem")}<select id="sample-rate" value={sampleRate ?? ''} onChange={e => setSampleRate(e.target.value ? Number(e.target.value) : null)} disabled={running}><option value="">{t("Manter da origem")}</option>{sampleRates.map(rate => <option key={rate} value={rate}>{rate} Hz</option>)}</select></label>
              <label htmlFor="channels">{t("Canais")}<select id="channels" value={channels ?? ''} onChange={e => setChannels(e.target.value ? Number(e.target.value) : null)} disabled={running}><option value="">{t("Manter da origem")}</option><option value="1">Mono</option><option value="2">{t("Estéreo")}</option></select></label>
              {format === 'wav' && <label htmlFor="wav-depth">{t("Profundidade PCM")}<select id="wav-depth" value={wavBitDepth} onChange={e => setWavBitDepth(Number(e.target.value) as 16 | 24)} disabled={running}><option value="16">16 bits</option><option value="24">24 bits</option></select></label>}
            </div>
            {format === 'wav' && <div className="format-note"><Toggle id="wav-without-cover" checked={allowWavWithoutCover} disabled={running} onChange={setAllowWavWithoutCover} label={t('Permitir conversão WAV sem capa. A capa será omitida apenas dos arquivos convertidos; os originais não serão alterados.')} /></div>}
          </div>
          <div className="destination"><div className="label-row"><label>{t("DESTINO")}</label><span>{t("ONDE SALVAR")}</span></div><button className="directory" onClick={chooseDirectory} disabled={!!running}><Icon name="folder" size={19} /><span title={displayDestination(dir)}>{dir ? displayDestination(dir) : t("Escolher pasta de destino")}</span><Icon name="arrow" size={17} /></button><div className="destination-actions"><button className="open-destination" onClick={openDestination} disabled={!dir} aria-label={t('Abrir pasta de destino')}><Icon name="folder" size={14} /> {t('Abrir pasta')}</button><Toggle id="open-after-batch" checked={openAfterBatch} disabled={running} onChange={setOpenAfterBatch} label={t('Abrir pasta após o lote')} /></div></div>
          {error && <div className="alert" role="alert">{error}</div>}
          {toolState === 'loading' && <div className="alert" role="status">{t('Verificando FFmpeg e FFprobe...')}</div>}
          {toolState !== 'loading' && !toolsReady && <div className="alert" role="alert">
            {toolState === 'error' ? t('Não foi possível verificar as ferramentas.') : <>
              {!tools?.conversion_allowed && <p>{t('A conversão está desativada nesta versão de distribuição, mesmo que as ferramentas estejam instaladas.')}</p>}
              {(['ffmpeg', 'ffprobe'] as const).map(name => tools?.[name].status !== 'available' && <p key={name}>{name === 'ffmpeg' ? 'FFmpeg' : 'FFprobe'}: {t(tools?.[name].status === 'not_found' ? 'não encontrado no PATH.' : tools?.[name].status === 'timed_out' ? 'tempo de verificação esgotado.' : 'falha ao executar.')}</p>)}
              {tools?.conversion_allowed && <p>{t('Verifique a instalação local e o PATH.')}</p>}
            </>}
            <button type="button" className="queue-clear" onClick={checkTools} disabled={running}>{t('Verificar novamente')}</button>
          </div>}
          </div>
          <div className="actions">{running ? <button className="cancel" onClick={cancel} disabled={cancelling}><Icon name="close" size={16} /> {cancelling ? t("Cancelando lote...") : t("Cancelar lote")}</button> : <button className="convert" onClick={convert} disabled={!toolsReady || !items.length || !dir || !listenerReady || adding || retryIndices(items).length === 0}><span>{items.length > 0 && retryIndices(items).length === 0 ? t("Concluído") : t(items.length === 1 ? 'Converter áudio' : 'Converter áudios')}</span><Icon name="arrow" size={20} /></button>}</div>
        </div>
        </div>
      </section><div className="bottom-line"><span>{t("CONVERSÃO LOCAL")} <b>✳</b> {t("SOM EM FOCO")}</span><span>MP3 · FLAC · WAV · M4A · OGG · OPUS</span></div>
    </main><footer><span>{t("PROJETADO PARA OUVIR MAIS.")}</span><span className="footer-credit"><img src="/brand/egregora-flower-512.webp" alt="" /> Egrégora Labs</span></footer>
    {confirmClear && <dialog ref={dialog} className="queue-dialog" aria-labelledby="clear-title" aria-describedby="clear-description" onClose={() => { setConfirmClear(false); clearButton.current?.focus(); }}><h2 id="clear-title">{t("Limpar lista?")}</h2><p id="clear-description">{t("Os arquivos serão removidos apenas da lista; nada será apagado do computador.")}</p><div><button autoFocus onClick={() => dialog.current?.close()}>{t("Cancelar")}</button><button onClick={() => { if (!locked.current) { setItems([]); } dialog.current?.close(); card.current?.focus(); }}>{t("Limpar lista")}</button></div></dialog>}
  </div>;
}
