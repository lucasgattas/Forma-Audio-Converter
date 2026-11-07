import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}), console, Map, Promise, Error, String, Math });

test('formatos e parâmetros respeitam o contrato', () => {
  for (const format of ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus']) assert.match(source, new RegExp(`id: '${format}'`));
  assert.equal(typeof exports.conversionOptions, 'function');
  for (const format of ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus']) {
    const result = exports.conversionOptions(format, 320, null, null, 24);
    assert.equal(result.bitrateKbps, ['flac', 'wav'].includes(format) ? null : 320);
    assert.equal(result.sampleRate, null);
    assert.equal(result.channels, null);
    assert.equal(result.wavBitDepth, format === 'wav' ? 24 : null);
  }
  const result = exports.conversionOptions('wav', 128, 96000, 1, 16);
  assert.equal(result.sampleRate, 96000);
  assert.equal(result.channels, 1);
  assert.equal(result.wavBitDepth, 16);
});

test('opções avançadas preservam origem e são usadas no lote', () => {
  for (const rate of [22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000]) assert.match(source, new RegExp(`\\b${rate}\\b`));
  assert.match(source, /useState<number \| null>\(null\)/);
  assert.match(source, /start: inputPath => invoke<string>\('start_conversion',\s*\{[^}]*\.\.\.conversionOptions\(format, bitrate, sampleRate, channels, wavBitDepth\)/);
  assert.match(source, /não recupera/i);
});