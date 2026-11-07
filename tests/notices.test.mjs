import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const exists = path => existsSync(new URL(`../${path}`, import.meta.url));

const release = JSON.parse(read('src-tauri/tauri.public-release.conf.json'));
const notices = read('THIRD-PARTY-NOTICES.txt');
const pkg = JSON.parse(read('package.json'));

const binaryEntries = Object.keys(release.bundle.resources).filter(path => /\.(exe|dll)$/i.test(path));
const binaries = binaryEntries.map(path => path.split('/').pop());
const bundleDir = binaryEntries[0].split('/').slice(0, -1).join('/').replace(/^\.\.\//, '');

const licenseTexts = [...new Set([...notices.matchAll(/licenses\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g)].map(match => match[0]))];
const licenseSources = ['packaging/licenses', 'docs/ffmpeg-own-evidence/release-readiness/licenses'];
const licenseExists = name => licenseSources.some(dir => exists(`${dir}/${name.replace('licenses/', '')}`));

test('a lista de binários do pacote bate com o manifesto publicado', () => {
  const manifest = read('packaging/ffmpeg-binaries.txt')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  assert.equal(binaries.length, 18);
  assert.deepEqual(binaries.slice().sort(), manifest.slice().sort());
});

test('se a pasta de binários existir aqui, ela tem exatamente esses arquivos', t => {
  if (!exists(bundleDir)) return t.skip('binários do FFmpeg não estão neste checkout');
  const onDisk = readdirSync(new URL(`../${bundleDir}`, import.meta.url)).sort();
  assert.deepEqual(binaries.slice().sort(), onDisk);
});

test('todo binário distribuído é citado nos avisos de terceiros', () => {
  const missing = binaries.filter(name => !notices.includes(name));
  assert.deepEqual(missing, [], `Binários sem aviso em THIRD-PARTY-NOTICES.txt: ${missing.join(', ')}`);
});

test('os avisos cobrem a licença do projeto e a separação da licença MIT', () => {
  assert.match(notices, /licença MIT/i);
  assert.match(notices, /arquivo LICENSE/);
  assert.match(notices, /Egrégora Labs/);
  assert.match(read('LICENSE'), /^MIT License/);
});

test('os avisos descrevem a substituição e o relink das bibliotecas LGPL', () => {
  assert.match(notices, /SUBSTITUIÇÃO E RELINK DAS BIBLIOTECAS LGPL/);
  assert.match(notices, /LGPL 2\.1, seção 6/);
  assert.match(notices, /substituir qualquer uma dessas DLLs/i);
  assert.match(notices, /não verifica seu\s+conteúdo por hash/);
  assert.match(notices, /mecanismo de\s+biblioteca compartilhada adequado/);
  assert.match(notices, /forma-<versão>-corresponding-sources\.tar\.gz/);
});

test('os avisos trazem o runtime GCC e a CRT do MinGW-w64', () => {
  assert.match(notices, /GCC Runtime Library Exception, versão 3\.1/);
  assert.match(notices, /Zope Public License 2\.1/);
  assert.match(notices, /licenses\/crt-COPYING\.MinGW-w64-runtime\.txt/);
});

test('todo texto de licença citado nos avisos existe na evidência do projeto', () => {
  assert.ok(licenseTexts.length >= 12, `Textos citados: ${licenseTexts.length}`);
  const missing = licenseTexts.filter(name => !licenseExists(name));
  assert.deepEqual(missing, [], `Textos de licença ausentes: ${missing.join(', ')}`);
});

test('o cabeçalho dos avisos acompanha a versão do aplicativo', () => {
  assert.match(notices, new RegExp(`^FORMA AUDIO CONVERTER ${pkg.version.replace(/\./g, '\\.')}$`, 'm'));
});
