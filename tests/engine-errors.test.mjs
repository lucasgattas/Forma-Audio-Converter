import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/languages.ts', import.meta.url), 'utf8');
const { translate } = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);

test('known engine errors translate in every supported language without changing unknown details', () => {
  const key = 'Arquivo de entrada não encontrado.';
  assert.equal(translate('pt-BR', key), key);
  assert.equal(translate('en', key), 'Input file not found.');
  for (const language of ['es', 'fr', 'de']) assert.notEqual(translate(language, key), key);
  for (const language of ['pt-BR', 'en', 'es', 'fr', 'de']) assert.equal(translate(language, 'Unexpected: /music/a.wav'), 'Unexpected: /music/a.wav');
});

test('conversion errors are translated at render time and command errors at display boundaries', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /t\(item\.error\)/);
  assert.match(app, /t\(message\(e\)\)/);
});
