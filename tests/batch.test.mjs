import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({}), console, Map, Promise, Error, String, Math });

test('abre uma vez após sucesso parcial e informa falha de abertura', async () => {
  const calls = [];
  const runner = exports.createBatchRunner({
    start: async path => { if (path === 'bad') throw Error('conversion'); return path; },
    cancel: async () => {}, update: () => {},
    openAfter: async () => { calls.push('open'); throw Error('open failed'); },
    onOpenError: error => calls.push(error.message),
  });
  const done = runner.run(['ok', 'bad']);
  await new Promise(resolve => setTimeout(resolve, 0));
  runner.onProgress({ jobId: 'ok', status: 'completed', progress: 1, outputPath: 'ok.mp3', error: null });
  await done;
  assert.deepEqual(calls, ['open', 'open failed']);
});

test('não abre após falha total nem após cancelamento mesmo com sucesso anterior', async () => {
  let opens = 0;
  const failed = exports.createBatchRunner({ start: async () => { throw Error('bad'); }, cancel: async () => {}, update: () => {}, openAfter: async () => { opens++; } });
  await failed.run(['bad']);
  const runner = exports.createBatchRunner({ start: async path => path, cancel: async () => {}, update: () => {}, openAfter: async () => { opens++; } });
  const done = runner.run(['ok', 'next']);
  await new Promise(resolve => setTimeout(resolve, 0));
  runner.onProgress({ jobId: 'ok', status: 'completed', progress: 1, outputPath: 'ok.mp3', error: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  await runner.cancel();
  runner.onProgress({ jobId: 'next', status: 'cancelled', progress: null, outputPath: null, error: null });
  await done;
  assert.equal(opens, 0);
});

test('processa arquivos sequencialmente e continua após falha', async () => {
  assert.equal(typeof exports.createBatchRunner, 'function', 'o executor de lote deve existir');
  const starts = [], updates = [];
  let emit;
  const runner = exports.createBatchRunner({
    start: async path => { starts.push(path); if (path === 'b') throw Error('falhou'); return path; },
    cancel: async () => {}, update: (index, event) => updates.push([index, event.status]),
  });
  emit = runner.onProgress;
  const done = runner.run(['a', 'b', 'c']);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(starts, ['a']);
  emit({ jobId: 'a', status: 'completed', progress: 1, outputPath: 'a.mp3', error: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(starts, ['a', 'b', 'c']);
  emit({ jobId: 'c', status: 'completed', progress: 1, outputPath: 'c.mp3', error: null });
  await done;
  assert.ok(updates.some(([i, status]) => i === 1 && status === 'error'));
});

test('cancelamento durante início não inicia outro arquivo e preserva resultado concluído', async () => {
  let resolveStart;
  const calls = [], updates = [];
  const runner = exports.createBatchRunner({
    start: path => { calls.push(path); return new Promise(resolve => { resolveStart = resolve; }); },
    cancel: async id => { calls.push(`cancel:${id}`); },
    update: (index, event) => updates.push([index, event.status]),
  });
  const done = runner.run(['a', 'b']);
  await runner.cancel();
  runner.onProgress({ jobId: '1', status: 'completed', progress: 1, outputPath: 'a.mp3', error: null });
  resolveStart('1');
  await done;
  assert.deepEqual(calls, ['a']);
  assert.deepEqual(updates.map(x => x.join(':')), ['0:running', '0:completed', '1:cancelled']);
});

test('cancelamento ativo aguarda confirmação e não inicia próximos', async () => {
  const calls = [], updates = [];
  const runner = exports.createBatchRunner({
    start: async path => { calls.push(path); return 'job'; },
    cancel: async id => { calls.push(`cancel:${id}`); },
    update: (index, event) => updates.push([index, event.status]),
  });
  let done = false;
  const run = runner.run(['a', 'b']).then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  await runner.cancel();
  assert.equal(done, false);
  runner.onProgress({ jobId: 'job', status: 'cancelled', progress: null, outputPath: null, error: null });
  await run;
  assert.deepEqual(calls, ['a', 'cancel:job']);
  assert.deepEqual(updates.map(x => x.join(':')), ['0:running', '0:cancelled', '1:cancelled']);
});
