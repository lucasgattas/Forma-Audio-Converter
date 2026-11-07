import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => JSON.parse(readFileSync(join(root, 'src-tauri', name), 'utf8'));

const base = read('tauri.conf.json');
const release = read('tauri.public-release.conf.json');

test('a política de conteúdo libera o protocolo de mídia do player', () => {
  const csp = base.app.security.csp;
  const media = /media-src([^;]*)/.exec(csp)?.[1] ?? '';
  const connect = /connect-src([^;]*)/.exec(csp)?.[1] ?? '';
  assert.ok(media.includes('http://forma-media.localhost'), 'sem media-src o áudio é bloqueado no app instalado');
  assert.ok(media.includes('blob:'));
  assert.ok(connect.includes('http://forma-media.localhost'));
});

test('a configuração de release herda a política, em vez de reescrevê-la', () => {
  // Já houve uma cópia própria de CSP no config de release, sem media-src, e o
  // player só falhava no app instalado, nunca em desenvolvimento.
  assert.equal(release.app.security, undefined, 'não repita o CSP no config de release');
  const effective = release.app.security?.csp ?? base.app.security.csp;
  assert.ok(effective.includes('media-src'));
});
