import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, 'src-tauri', 'tauri.public-release.conf.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const resources = config.bundle.resources;

test('todo recurso do pacote vive dentro do projeto', () => {
  // Já houve empacotamento apontando para uma pasta de scratch, que é apagada sozinha.
  const outside = Object.keys(resources).filter(key => /AppData|[A-Za-z]:[\\/]/.test(key));
  assert.deepEqual(outside, []);
  for (const key of Object.keys(resources)) {
    const absolute = resolve(root, 'src-tauri', key);
    assert.ok(absolute.startsWith(root), `${key} sai do projeto`);
  }
});

test('todo recurso presente neste checkout aponta para um arquivo real', t => {
  // Os binários do FFmpeg não vão ao repositório, então o teste cobra o que existe aqui.
  const keys = Object.keys(resources);
  const present = keys.filter(key => existsSync(resolve(root, 'src-tauri', key)));
  if (present.length === 0) return t.skip('nenhum recurso materializado neste checkout');
  for (const key of present) assert.ok(existsSync(resolve(root, 'src-tauri', key)), `${key} não existe`);
  assert.ok(present.includes('THIRD-PARTY-NOTICES.txt') || present.some(key => key.endsWith('THIRD-PARTY-NOTICES.txt')));
});

test('o aviso de terceiros empacotado é cópia fiel do aviso do projeto', () => {
  const source = readFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'));
  const staged = readFileSync(join(root, 'packaging', 'notices', 'THIRD-PARTY-NOTICES.txt'));
  assert.ok(source.equals(staged), 'packaging/notices desatualizado, rode node scripts/stage-release-assets.mjs');
  assert.ok(readFileSync(join(root, 'LICENSE')).equals(readFileSync(join(root, 'packaging', 'notices', 'LICENSE'))));
});

test('o pacote carrega os 17 textos de licença citados no aviso', () => {
  const staged = readdirSync(join(root, 'packaging', 'notices', 'licenses')).sort();
  assert.equal(staged.length, 17);
  const notices = readFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  const referenced = staged.filter(name => !notices.includes(`licenses/${name}`) && !notices.includes(name));
  assert.deepEqual(referenced, [], 'todo texto de licença precisa ser citado no aviso');
});

test('o instalador não publica licença pela metade', () => {
  const targets = Object.values(resources);
  assert.equal(new Set(targets).size, targets.length, 'nenhum destino repetido');
  const licenses = targets.filter(target => target.startsWith('licenses/'));
  assert.equal(licenses.length, 17);
  assert.ok(targets.includes('THIRD-PARTY-NOTICES.txt'));
  assert.ok(targets.includes('LICENSE'));
});
