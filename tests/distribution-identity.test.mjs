import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

test('distribution identity uses the Forma name and identifier', () => {
  assert.equal(config.productName, 'Forma Audio Converter');
  assert.equal(config.identifier, 'com.egregoralabs.forma');
});

test('bundling remains disabled', () => {
  assert.equal(config.bundle.active, false);
});
