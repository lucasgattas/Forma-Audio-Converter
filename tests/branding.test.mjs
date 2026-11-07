import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('window and development status identify Forma beta', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const translations = readFileSync(new URL('../src/languages.ts', import.meta.url), 'utf8');
  assert.equal(config.app.windows[0].title, 'Forma Audio Converter');
  assert.match(source, /t\('VERSÃO BETA'\)/);
  assert.match(translations, /\['VERSÃO BETA','BETA VERSION','VERSIÓN BETA','VERSION BÊTA','BETA-VERSION'\]/);
});

test('Tauri uses the green Forma icon at every original resolution', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.brand-mark\{[^}]*color:#c2e78c/i);
  assert.deepEqual(config.bundle.icon, ['icons/icon.ico']);
  const ico = readFileSync(new URL('../src-tauri/icons/icon.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const expected = new Map([
    [32, '41590c9693e116c6cdad3079312f07ab7b758a2a89a06dfa90c78b2620e16297'],
    [48, 'dbea966884f3d06c234fba7b9bf81308ac2f833d1aa1110b68b5b4805ac92546'],
    [256, 'eec4f395aaf10fd1888f73a1c03a097cbe34bd20a35d1871ef2e34e023d72206'],
  ]);
  for (let i = 0; i < 3; i++) {
    const entry = 6 + i * 16;
    const width = ico[entry] || 256;
    assert.equal(ico[entry + 1] || 256, width);
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset >= 54 && offset + size <= ico.length);
    const frame = ico.subarray(offset, offset + size);
    assert.equal(frame.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(frame.readUInt32BE(16), width);
    assert.equal(frame.readUInt32BE(20), width);
    assert.equal(createHash('sha256').update(frame).digest('hex'), expected.get(width));
    expected.delete(width);
  }
  assert.equal(expected.size, 0);
});
