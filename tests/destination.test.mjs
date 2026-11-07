import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}), console, Map, Promise, Error, String, Math });

test('exibe caminhos estendidos comuns sem alterar caminhos especiais', () => {
  assert.equal(exports.displayDestination('\\\\?\\C:\\Music'), 'C:\\Music');
  assert.equal(exports.displayDestination('\\\\?\\UNC\\server\\share\\Music'), '\\\\server\\share\\Music');
  for (const path of ['\\\\?\\Volume{abc}\\folder', '\\\\?\\C:\\folder.\\x', '\\\\?\\C:\\a\\..\\b', '\\\\?\\UNC\\server', 'C:\\Music']) assert.equal(exports.displayDestination(path), path);
});
