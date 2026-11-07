import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const media = readFileSync(new URL('../src-tauri/src/media.rs', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('a interface só toca o que está na fila, por protocolo próprio', () => {
  assert.match(app, /invoke\('set_playable_files', \{ paths \}\)/);
  assert.match(app, /const paths = items\.map\(item => item\.path\);/);
  assert.match(app, /element\.src = `http:\/\/forma-media\.localhost\/\?p=\$\{encodeURIComponent\(item\.path\)\}`/);
  assert.doesNotMatch(app, /convertFileSrc\(/, 'o player não deve expor caminho de disco ao webview');
});

test('o backend publica, autoriza e serve apenas arquivos da allowlist', () => {
  assert.match(main, /register_asynchronous_uri_scheme_protocol\("forma-media"/);
  assert.match(main, /media::set_playable_files/);
  assert.match(media, /pub fn set_playable_files\(state: tauri::State<'_, Playable>, paths: Vec<String>\)/);
  // Fail-closed: a autorização acontece antes de abrir o arquivo e nega o que não foi publicado.
  const authorize = media.slice(media.indexOf('fn authorize'));
  assert.match(authorize, /if !allowed\.contains\(&key\) \{\s*\n\s*return Err\(Denial::Forbidden\);/);
  assert.match(authorize, /content_type\(&canonical\)\.is_none\(\)[\s\S]{0,40}Denial::Forbidden/);
  // Sem allowlist vazia servindo tudo: o conjunto publicado substitui o anterior.
  assert.match(media, /\*state\.0\.lock\(\)[^=]*= set;/);
});

test('o protocolo responde a Range e nunca excede o teto por resposta', () => {
  assert.match(media, /const MAX_CHUNK: u64 = 8 \* 1024 \* 1024;/);
  assert.match(media, /ACCEPT_RANGES, "bytes"/);
  assert.match(media, /if status == StatusCode::PARTIAL_CONTENT/);
  assert.match(media, /RANGE_NOT_SATISFIABLE/);
});

test('a CSP permite o protocolo de mídia sem abrir o resto', () => {
  const csp = conf.app.security.csp;
  assert.match(csp, /media-src 'self' http:\/\/forma-media\.localhost blob:/);
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /default-src[^;]*\*/);
});

test('falha de reprodução usa aviso próprio e some ao trocar de arquivo ou converter', () => {
  assert.match(app, /const \[playerError, setPlayerError\] = useState\(''\);/);
  assert.match(app, /setPlayerError\(t\('Não foi possível reproduzir este arquivo\.'\)\)/);
  assert.match(app, /\{playerError && <div className="alert alert-player" role="alert">\{playerError\}<\/div>\}/);
  // Some quando a fila muda e quando a conversão começa, sem apagar o alerta geral do app.
  assert.match(app, /const paths = items\.map\(item => item\.path\);\s*setPlayerError\(''\);/);
  assert.match(app, /async function convert\(\) \{\s*setPlayerError\(''\);/);
});

test('o botão de reprodução é acessível e o Remover fica abaixo do nome, à esquerda', () => {
  assert.match(app, /className="play-button"/);
  assert.match(app, /aria-label=\{`\$\{playing === inputPathKey\(item\.path\) \? t\('Pausar'\) : t\('Reproduzir'\)\}/);
  assert.match(css, /\.batch-item-actions \{ display: flex; align-items: center; justify-content: flex-start;/);
  assert.match(css, /\.play-button \{[^}]*width: 28px; height: 28px;/);
  assert.match(css, /\.play-button:focus-visible \{ outline: 2px solid #c2e78c;/);
});
