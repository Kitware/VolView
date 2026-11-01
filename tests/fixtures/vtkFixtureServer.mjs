import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export async function startVtkFixture(directory) {
  const cacheDir = await mkdtemp(resolve(tmpdir(), 'vtk-fixture-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(directory),
    cacheDir,
    resolve: { alias: { '@': root } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
  });
  await server.listen();
  return {
    url: server.resolvedUrls.local[0],
    async close() {
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}
