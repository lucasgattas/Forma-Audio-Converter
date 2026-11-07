import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Barra invertida montada em tempo de execução: imune a escapes de shell e de editor.
const B = String.fromCharCode(92);
const sep = (base, ...parts) => [base, ...parts].join(B);
const extended = B + B + '?' + B;

const source = readFileSync(new URL('../src/persistence.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const store = {};
vm.runInNewContext(code, { exports: store, require: () => ({}), console, JSON, Set, Math, Object, Array, String, Number });

const formats = ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus'];
const sampleRates = [22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
const options = { formats, sampleRates };

const memory = { bitrate: 256, sampleRate: 48000, channels: 2, wavBitDepth: 24 };
const entry = path => ({ path, info: { duration: 187.4, sampleRate: 44100, channels: 2, codec: 'pcm_s16le' } });
// Objetos do vm têm outro protótipo: normaliza para comparar estrutura.
const plain = value => JSON.parse(JSON.stringify(value));

test('um estado salvo volta igual depois de recarregado', () => {
  const dir = sep('C:', 'Saída');
  const saved = store.captureState({
    format: 'flac', dir, openFolder: true, allowWavWithoutCover: true,
    memory: { mp3: { bitrate: 192, sampleRate: null, channels: 1, wavBitDepth: 16 } },
    active: memory, queue: [entry(sep('C:', 'A.wav')), entry(sep('C:', 'B.wav'))],
    formats, sampleRates,
  });
  const back = store.parseState(JSON.stringify(saved), options);
  assert.equal(back.format, 'flac');
  assert.equal(back.dir, dir);
  assert.equal(back.openFolder, true);
  assert.equal(back.allowWavWithoutCover, true);
  assert.deepEqual(plain(back.active), memory);
  assert.equal(back.queue.length, 2);
  assert.deepEqual(plain(back.queue[0].info), { duration: 187.4, sampleRate: 44100, channels: 2, codec: 'pcm_s16le' });
  assert.deepEqual(plain(back.perFormat.mp3), { bitrate: 192, sampleRate: null, channels: 1, wavBitDepth: 16 });
});

test('lixo, versão antiga e formato desconhecido caem nos padrões', () => {
  const empty = store.parseState(null, options);
  assert.equal(empty.format, 'mp3');
  assert.equal(empty.dir, '');
  assert.equal(empty.queue.length, 0);
  assert.deepEqual(plain(empty.active), { bitrate: 320, sampleRate: null, channels: null, wavBitDepth: 16 });

  for (const raw of ['{não é json', '[]', '"texto"', '42', 'null']) {
    assert.deepEqual(plain(store.parseState(raw, options).active), plain(empty.active), `entrada ${raw}`);
  }
  const old = store.parseState(JSON.stringify({ version: 0, format: 'flac', queue: [entry(sep('C:', 'A.wav'))] }), options);
  assert.equal(old.format, 'mp3');
  assert.equal(old.queue.length, 0);

  const alien = store.parseState(JSON.stringify({ version: 1, format: 'mp4', queue: [] }), options);
  assert.equal(alien.format, 'mp3');
});

test('ajustes fora da faixa são corrigidos em vez de aceitos', () => {
  const s = store.parseState(JSON.stringify({
    version: 1, format: 'mp3',
    perFormat: { mp3: { bitrate: 9999, sampleRate: 12345, channels: 7, wavBitDepth: 32 } },
    queue: [],
  }), options);
  assert.deepEqual(plain(s.active), { bitrate: 320, sampleRate: null, channels: null, wavBitDepth: 16 });
  const low = store.parseState(JSON.stringify({ version: 1, format: 'mp3', perFormat: { mp3: { bitrate: 8 } }, queue: [] }), options);
  assert.equal(low.active.bitrate, 128);
  const fractional = store.parseState(JSON.stringify({ version: 1, format: 'mp3', perFormat: { mp3: { bitrate: 191.6 } }, queue: [] }), options);
  assert.equal(fractional.active.bitrate, 192);
});

test('a fila descarta entradas inválidas e repetidas, sem apagar o resto', () => {
  const upper = sep('C:', 'Músicas', 'A.wav');
  const s = store.parseState(JSON.stringify({
    version: 1, format: 'mp3',
    queue: [
      entry(upper),
      entry('c:/músicas/a.wav'),
      entry(extended + upper),
      { path: '' }, { path: 42 }, null, entry(sep('C:', 'B.wav')),
    ],
  }), options);
  assert.deepEqual(plain(s.queue.map(item => item.path)), [upper, sep('C:', 'B.wav')]);
});

test('fila é limitada e a chave de caminho ignora maiúsculas e o prefixo estendido', () => {
  const many = Array.from({ length: 12 }, (_, i) => entry(sep('C:', `T${i}.wav`)));
  const s = store.parseState(JSON.stringify({ version: 1, format: 'wav', queue: many }), { ...options, maxQueue: 5 });
  assert.equal(s.queue.length, 5);
  assert.equal(store.normalizeKey(extended + sep('C:', 'Pasta', 'X.WAV')), sep('c:', 'pasta', 'x.wav'));
  assert.equal(store.normalizeKey('C:/Pasta/X.wav'), sep('c:', 'pasta', 'x.wav'));
});

test('armazenamento indisponível não quebra a sessão', () => {
  const fake = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; } };
  const state = store.parseState(null, options);
  assert.equal(store.saveState(fake, state), true);
  assert.equal(store.readStoredState(fake, options).format, 'mp3');
  assert.equal(store.saveState(null, state), false);
  assert.equal(store.readStoredState(null, options).format, 'mp3');
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.equal(store.readStoredState(broken, options).format, 'mp3');
  assert.equal(store.saveState(broken, state), false);
});
