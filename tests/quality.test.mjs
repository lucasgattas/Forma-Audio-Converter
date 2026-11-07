import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}), console, Map, Promise, Error, String, Math, Set });

test('quality profiles correspond to each existing bitrate', () => {
  assert.deepEqual(Array.from(exports.qualityProfiles, profile => profile.bitrate), [128, 192, 256, 320]);
  for (const profile of exports.qualityProfiles) {
    assert.ok(profile.en && profile.pt);
    assert.equal(exports.conversionOptions('mp3', profile.bitrate, null, null, 16).bitrateKbps, profile.bitrate);
  }
});

test('profile controls are localized, selected by bitrate, and disabled while converting', () => {
  assert.match(source, /aria-label=\{t\("Perfil de qualidade"\)\}/);
  assert.match(source, /qualityProfiles\.map/);
  assert.match(source, /aria-pressed=\{bitrate === profile\.bitrate\}/);
  assert.match(source, /onClick=\{\(\) => setBitrate\(profile\.bitrate\)\}/);
  assert.match(source, /"Perfil de qualidade": "Quality profile"/);
  assert.match(source, /disabled=\{running\} aria-pressed=\{bitrate === profile\.bitrate\}/);
  assert.match(source, /id="bitrate" type="range"/);
});

test('lossless output ignores bitrate and quality changes reset queue via configuration', () => {
  assert.equal(exports.conversionOptions('flac', 128, null, null, 16).bitrateKbps, null);
  assert.equal(exports.conversionOptions('wav', 320, null, null, 24).bitrateKbps, null);
  assert.match(source, /JSON\.stringify\(\[dir, format, conversionOptions\(format, bitrate, sampleRate, channels, wavBitDepth\), format === 'wav' && allowWavWithoutCover\]\)/);
  assert.match(source, /status: 'pending', progress: null, outputPath: null, error: null/);
});
