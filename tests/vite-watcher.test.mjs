import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

test('Vite watches frontend changes but not Rust target directories', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR, 'forma-vite-watch-'));
  const frontend = join(root, 'src', 'app.ts');
  const targets = ['target', 'private-clean-installer-20261107/target', 'nested/build/target'];
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(frontend, 'export const value = 1;');
  for (const target of targets) {
    await mkdir(join(root, target, 'debug'), { recursive: true });
    await writeFile(join(root, target, 'debug', 'artifact'), 'build');
  }
  const server = await createServer({
    configFile: resolve('vite.config.ts'), root,
    server: { port: 0, strictPort: false },
  });
  try {
    const ready = new Promise((resolve, reject) => {
      server.watcher.once('ready', resolve);
      server.watcher.once('error', reject);
    });
    await server.listen();
    await ready;
    await new Promise(resolve => setTimeout(resolve, 1000));
    const watched = Object.keys(server.watcher.getWatched()).map(path => path.replaceAll('\\', '/'));
    for (const target of targets) {
      assert.ok(!watched.some(path => path === `${root.replaceAll('\\', '/')}/${target}` || path.startsWith(`${root.replaceAll('\\', '/')}/${target}/`)), `${target} is watched`);
    }
    const changed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('frontend change not observed')), 5000);
      server.watcher.on('change', path => {
        if (path === frontend) { clearTimeout(timer); resolve(); }
      });
    });
    await writeFile(frontend, 'export const value = 2;');
    await changed;
  } finally {
    await server.close();
  }
});
