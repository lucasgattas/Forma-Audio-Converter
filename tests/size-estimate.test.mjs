import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const api = {};
vm.runInNewContext(code, { exports: api, require: () => ({}), console, Map, Promise, Error, String, Math, Number, Set });

test('estimativa com perdas usa duração e bitrate inteiro', () => {
  assert.equal(typeof api.estimateBytes, 'function');
  assert.equal(api.estimateBytes({ duration: 60, sampleRate: null, channels: null }, 'mp3', 193, null, null, 16), 1447500);
});

test('WAV exige metadados conhecidos e respeita opções; FLAC é desconhecido', () => {
  const info = { duration: 10, sampleRate: 48000, channels: 2 };
  assert.equal(api.estimateBytes(info, 'wav', 192, null, null, 24), 2880000);
  assert.equal(api.estimateBytes(info, 'wav', 192, 44100, 1, 16), 882000);
  assert.equal(api.estimateBytes({ ...info, channels: null }, 'wav', 192, null, null, 16), null);
  assert.equal(api.estimateBytes(info, 'flac', 192, null, null, 16), null);
  assert.equal(api.estimateBytes({ ...info, duration: null }, 'mp3', 192, null, null, 16), null);
});

test('total parcial nunca é tratado como completo', () => {
  assert.equal(typeof api.summarizeEstimates, 'function');
  const partial = api.summarizeEstimates([100, null, 200]);
  assert.equal(partial.bytes, 300);
  assert.equal(partial.unknown, 1);
  assert.equal(api.summarizeEstimates([null, null]).bytes, null);
});

test('slider livre e metadados da fila são preservados', () => {
  assert.match(source, /id="bitrate" type="range" min="128" max="320" step="1" value=\{bitrate\}/);
  assert.match(source, /info: result\.metadata\[path\]/);
  assert.doesNotMatch(source, /const singlePath/);
});
