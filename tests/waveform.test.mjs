import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
const waveform = readFileSync(join(root, 'src', 'Waveform.tsx'), 'utf8');
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
const rust = readFileSync(join(root, 'src-tauri', 'src', 'waveform.rs'), 'utf8');

test('a onda vem do backend, uma vez por arquivo, com colunas fixas', () => {
  assert.match(app, /invoke<number\[\]>\('audio_peaks', \{ path: item\.path, buckets: \d+ \}\)/);
  assert.match(app, /peaksInFlight/, 'não pode pedir a mesma onda duas vezes');
  assert.match(app, /peaksRef\.current/, 'o efeito não pode reler estado velho');
});

test('a onda desenha uma barra por coluna e não depende de canvas', () => {
  assert.match(waveform, /peaks\.map\(\(value, index\)/);
  assert.match(waveform, /<rect/);
  assert.doesNotMatch(waveform, /getContext\('2d'\)/);
  assert.match(css, /\.wave rect \{ fill: #6d7a5c; \}/);
});

test('clicar na onda busca o tempo proporcional, e sem duração não faz nada', () => {
  assert.match(waveform, /\(event\.clientX - box\.left\) \/ box\.width/);
  assert.match(app, /function seek\(item: Item, ratio: number\)/);
  assert.match(app, /const duration = item\.info\?\.duration \?\? 0;/);
  assert.match(app, /element\.currentTime = target;/);
  assert.match(app, /void togglePlay\(item, target\);/);
});

test('a linha do tempo acompanha o áudio e some fora da reprodução', () => {
  assert.match(app, /addEventListener\('timeupdate', sync\)/);
  assert.match(app, /\(item\.info\?\.duration \?\? 0\) > 0 \? position \/ \(item\.info\?\.duration \?\? 1\) : 0/);
  assert.match(waveform, /wave-playhead/);
  assert.match(css, /\.wave\.is-playing \.wave-playhead/);
  assert.doesNotMatch(app, /requestAnimationFrame\(/, 'não pode animar 60 vezes por segundo');
});

test('a onda é acessível por teclado e anuncia a posição', () => {
  assert.match(waveform, /role="slider"/);
  assert.match(waveform, /aria-valuenow=\{Math\.round\(ratio \* 100\)\}/);
  assert.match(waveform, /'ArrowRight'/);
  assert.match(waveform, /'ArrowLeft'/);
});

test('o backend limita colunas e tamanho da decodificação', () => {
  assert.match(rust, /pub const MIN_BUCKETS: u32 = 16;/);
  assert.match(rust, /pub const MAX_BUCKETS: u32 = 512;/);
  assert.match(rust, /const MAX_WINDOWS: usize = 36_000;/);
  assert.match(rust, /"-map", "0:a:0", "-ac", "1"/);
  assert.match(rust, /crate::binary\("ffmpeg"\)/, 'precisa usar o resolvedor de ferramentas do app');
  assert.doesNotMatch(rust, /Command::new\("ffmpeg"\)/, 'não pode depender do PATH');
});
