import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}), console, Map, Promise, Error, String, Math, Set });
test('adiciona arquivos válidos sem duplicar e rejeita pastas e formatos inválidos', async () => {
  assert.equal(typeof exports.validateInputs, 'function');
  const result = await exports.validateInputs(['C:\\audio.wav', 'C:\\pasta.mp3', 'C:\\texto.txt', 'C:\\audio.wav'], async path => { if (path.includes('pasta')) throw Error('inválido'); });
  assert.deepEqual(Array.from(result.accepted), ['C:\\audio.wav']);
  assert.equal(result.rejected, 2);
});
test('nova tentativa preserva concluídos e inclui erros e cancelados', () => {
  assert.equal(typeof exports.retryIndices, 'function');
  assert.deepEqual(Array.from(exports.retryIndices([{status:'completed'}, {status:'error'}, {status:'cancelled'}])), [1, 2]);
});
