import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}), console, Map, Promise, Error, String, Math, Set });
test('Windows canonical and regular paths use the same queue key', () => {
  assert.equal(exports.inputPathKey('\\\\?\\C:\\Music\\A.WAV'), exports.inputPathKey('c:/music/a.wav'));
});
test('case-sensitive paths remain distinct', () => {
  assert.notEqual(exports.inputPathKey('/music/A.wav'), exports.inputPathKey('/music/a.wav'));
});
test('folder selection exposes direct-files policy and command', () => {
  assert.match(source, /choose_input_folder/);
  assert.match(source, /Subpastas não são incluídas/);
});
