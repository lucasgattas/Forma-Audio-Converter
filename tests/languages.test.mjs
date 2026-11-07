import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

test('additional languages have complete translations and persisted selection', async () => {
  const source = readFileSync(new URL('../src/languages.ts', import.meta.url), 'utf8');
  const module = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  for (const language of ['es', 'fr', 'de']) {
    assert.equal(module.readLanguage(language), language);
    assert.deepEqual(Object.keys(module.locales[language]).sort(), Object.keys(module.locales.en).sort());
    for (const [key, text] of Object.entries(module.locales[language])) assert.ok(text, `${language}: ${key}`);
  }
  assert.equal(module.readLanguage('pt-BR'), 'pt-BR');
  assert.equal(module.readLanguage('unexpected'), 'en');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const match of app.matchAll(/\bt\(\s*(['"])(.*?)\1\s*\)/g)) {
    for (const language of ['en', 'es', 'fr', 'de']) {
      assert.ok(Object.hasOwn(module.locales[language], match[2]), `${language} missing ${match[2]}`);
    }
  }
});
