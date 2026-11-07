// Estado guardado entre sessões: fila, destino, ajustes e memória por formato.
// Tudo passa por validação defensiva aqui; qualquer valor estranho volta ao padrão.

export type StoredInfo = {
  duration: number | null;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
};

export type StoredEntry = { path: string; info: StoredInfo };

export type FormatMemory = {
  bitrate: number;
  sampleRate: number | null;
  channels: number | null;
  wavBitDepth: 16 | 24;
};

export type StoredState = {
  version: 1;
  format: string;
  dir: string;
  openFolder: boolean;
  allowWavWithoutCover: boolean;
  active: FormatMemory;
  perFormat: Record<string, FormatMemory>;
  queue: StoredEntry[];
};

export const STATE_KEY = 'forma.state.v1';
export const STATE_VERSION = 1;
export const MAX_QUEUE = 2000;
export const DEFAULT_BITRATE = 320;
export const MIN_BITRATE = 128;
export const MAX_BITRATE = 320;
export const MAX_PATH = 4096;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const wholeNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function normalizeKey(path: string) {
  return path
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '')
    .replace(/\//g, '\\')
    .toLowerCase();
}

function sanitizeInfo(value: unknown): StoredInfo {
  const raw = isRecord(value) ? value : {};
  const number = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 ? entry : null;
  return {
    duration: number(raw.duration),
    sampleRate: number(raw.sampleRate),
    channels: number(raw.channels),
    codec: typeof raw.codec === 'string' ? raw.codec : null,
  };
}

export function sanitizeMemory(value: unknown, sampleRates: readonly number[]): FormatMemory {
  const raw = isRecord(value) ? value : {};
  return {
    bitrate: wholeNumber(raw.bitrate, MIN_BITRATE, MAX_BITRATE, DEFAULT_BITRATE),
    sampleRate: typeof raw.sampleRate === 'number' && sampleRates.includes(raw.sampleRate) ? raw.sampleRate : null,
    channels: raw.channels === 1 || raw.channels === 2 ? raw.channels : null,
    wavBitDepth: raw.wavBitDepth === 24 ? 24 : 16,
  };
}

export type ParseOptions = { formats: readonly string[]; sampleRates: readonly number[]; maxQueue?: number };

/** Nunca lança: devolve sempre um estado utilizável, caindo para os padrões campo a campo. */
export function parseState(raw: unknown, options: ParseOptions): StoredState {
  const firstFormat = options.formats[0] ?? 'mp3';
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!isRecord(parsed) || parsed.version !== STATE_VERSION) {
    const empty = sanitizeMemory(null, options.sampleRates);
    return { version: 1, format: firstFormat, dir: '', openFolder: false, allowWavWithoutCover: false, active: empty, perFormat: {}, queue: [] };
  }
  const format = typeof parsed.format === 'string' && options.formats.includes(parsed.format) ? parsed.format : firstFormat;
  const perFormat: Record<string, FormatMemory> = {};
  if (isRecord(parsed.perFormat)) {
    for (const id of options.formats) {
      if (isRecord(parsed.perFormat[id])) perFormat[id] = sanitizeMemory(parsed.perFormat[id], options.sampleRates);
    }
  }
  const active = perFormat[format] ?? sanitizeMemory(null, options.sampleRates);
  const queue: StoredEntry[] = [];
  const seen = new Set<string>();
  const limit = Math.max(0, options.maxQueue ?? MAX_QUEUE);
  if (Array.isArray(parsed.queue)) {
    for (const entry of parsed.queue) {
      if (queue.length >= limit) break;
      if (!isRecord(entry) || typeof entry.path !== 'string') continue;
      const path = entry.path.trim();
      if (!path || path.length > MAX_PATH) continue;
      const key = normalizeKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ path, info: sanitizeInfo(entry.info) });
    }
  }
  return {
    version: 1,
    format,
    dir: typeof parsed.dir === 'string' && parsed.dir.length <= MAX_PATH ? parsed.dir : '',
    openFolder: parsed.openFolder === true,
    allowWavWithoutCover: parsed.allowWavWithoutCover === true,
    active,
    perFormat,
    queue,
  };
}

export function captureState(input: {
  format: string;
  dir: string;
  openFolder: boolean;
  allowWavWithoutCover: boolean;
  memory: Record<string, FormatMemory>;
  queue: { path: string; info: StoredInfo }[];
  formats: readonly string[];
  sampleRates: readonly number[];
  active: FormatMemory;
}): StoredState {
  return parseState({
    version: STATE_VERSION,
    format: input.format,
    dir: input.dir,
    openFolder: input.openFolder,
    allowWavWithoutCover: input.allowWavWithoutCover,
    perFormat: { ...input.memory, [input.format]: input.active },
    queue: input.queue,
  }, { formats: input.formats, sampleRates: input.sampleRates });
}

export function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null; // Armazenamento bloqueado pelo navegador ou pelo webview.
  }
}

export function readStoredState(storage: Storage | null, options: ParseOptions): StoredState {
  let raw: string | null = null;
  try { raw = storage?.getItem(STATE_KEY) ?? null; } catch { raw = null; }
  return parseState(raw, options);
}

export function saveState(storage: Storage | null, state: StoredState): boolean {
  try {
    storage?.setItem(STATE_KEY, JSON.stringify(state));
    return storage !== null;
  } catch {
    return false; // Cota cheia ou armazenamento indisponível: a sessão continua sem persistir.
  }
}

export function clearState(storage: Storage | null): void {
  try { storage?.removeItem(STATE_KEY); } catch { /* Sem armazenamento, nada a limpar. */ }
}
