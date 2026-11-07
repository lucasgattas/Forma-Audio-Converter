import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

const pkg = JSON.parse(read('package.json'));
const cargo = read('src-tauri/Cargo.toml').match(/^version = "(.+)"$/m)[1];
const conf = JSON.parse(read('src-tauri/tauri.conf.json')).version;
const release = JSON.parse(read('src-tauri/tauri.public-release.conf.json')).version;

test('a versão exibida vem de uma única fonte e está sincronizada', () => {
  assert.equal(cargo, pkg.version);
  assert.equal(conf, pkg.version);
  assert.equal(release, pkg.version);
});

test('o cabeçalho mostra a versão junto do rótulo beta', () => {
  const app = read('src/App.tsx');
  assert.match(app, /className="version">\{t\('VERSÃO BETA'\)\} \{__APP_VERSION__\}/);
  assert.match(read('vite.config.ts'), /__APP_VERSION__: JSON\.stringify\(pkg\.version\)/);
  assert.match(read('src/globals.d.ts'), /declare const __APP_VERSION__: string;/);
});

test('o CSP permite o protocolo de mídia da fila', () => {
  const csp = JSON.parse(read('src-tauri/tauri.conf.json')).app.security.csp;
  assert.match(csp, /media-src[^;]*http:\/\/forma-media\.localhost/);
});
