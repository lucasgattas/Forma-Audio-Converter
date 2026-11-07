import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
const languageSource = readFileSync(new URL('../src/languages.ts', import.meta.url), 'utf8');
const languageCode = ts.transpileModule(languageSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const languageExports = {};
vm.runInNewContext(languageCode, { exports: languageExports });
vm.runInNewContext(code, { exports, require: (name) => name === './languages' ? languageExports : ({}), console, Map, Promise, Error, String, Math, Set });
test('language defaults to English and supports persisted Brazilian Portuguese', () => {
  assert.equal(exports.readLanguage(null), 'en');
  assert.equal(exports.readLanguage('pt-BR'), 'pt-BR');
  assert.equal(exports.readLanguage('invalid'), 'en');
  assert.equal(exports.copy.en.files, 'Your files');
  assert.equal(exports.copy['pt-BR'].files, 'Seus arquivos');
});
test('destination opening delegates to native command without a path from the webview', () => {
  assert.match(source, /invoke\(['"]open_destination['"]\)/);
  assert.doesNotMatch(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'), /opener:allow-open-path/);
});
test('single-file probe is retained when validating inputs', async () => {
  const info = { duration: 12, sampleRate: 44100, channels: 2, codec: 'flac' };
  const result = await exports.validateInputs(['a.flac'], async () => info);
  assert.equal(result.metadata['a.flac'], info);
});
