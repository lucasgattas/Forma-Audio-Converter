// Copia os textos legais para packaging/notices, que é o que o instalador distribui.
// A raiz do projeto é a fonte: nada em packaging/ deve ser editado à mão.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = join(root, 'packaging', 'notices');
const licenseSource = join(root, 'packaging', 'licenses');

const files = [
  ['THIRD-PARTY-NOTICES.txt', join(root, 'THIRD-PARTY-NOTICES.txt')],
  ['LICENSE', join(root, 'LICENSE')],
];
const licenses = readdirSync(licenseSource)
  .filter(name => statSync(join(licenseSource, name)).isFile())
  .sort()
  .map(name => [`licenses/${name}`, join(licenseSource, name)]);

if (licenses.length !== 17) {
  throw new Error(`esperava 17 textos de licença em packaging/licenses, achei ${licenses.length}`);
}

rmSync(join(staging, 'licenses'), { recursive: true, force: true });
mkdirSync(join(staging, 'licenses'), { recursive: true });

for (const [target, source] of [...files, ...licenses]) {
  const destination = join(staging, target);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

// O aviso publicado precisa citar todos os binários que o pacote carrega.
const notices = readFileSync(join(staging, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.public-release.conf.json'), 'utf8'));
const binaries = Object.values(config.bundle.resources ?? {})
  .filter(target => target.startsWith('local-ffmpeg/'))
  .map(target => target.slice('local-ffmpeg/'.length));
const missing = binaries.filter(name => !notices.includes(name));
if (missing.length > 0) {
  throw new Error(`THIRD-PARTY-NOTICES.txt não cita: ${missing.join(', ')}`);
}

console.log(`packaging/notices: ${files.length + licenses.length} arquivos, ${binaries.length} binários citados no aviso`);
