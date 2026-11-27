import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('.', import.meta.url));
async function buildPage(kind, outDir) {
  await build({
    configFile: false,
    root: fixture,
    publicDir: false,
    base: './',
    logLevel: 'warn',
    resolve: { alias: [{ find: '@', replacement: root.replace(/\/$/, '') }] },
    build: {
      outDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: Infinity,
      rollupOptions: { input: resolve(fixture, `${kind}.html`) },
    },
    worker: { format: 'es' },
  });
}

/** Serves the byte range asked for, or the whole body when `range` is absent. */
function serveDicom(bytes, range, response) {
  const match = /^bytes=(\d+)-(\d*)/.exec(range ?? '');
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2]
    ? Math.min(bytes.length, Number(match[2]) + 1)
    : bytes.length;
  response.setHeader('Content-Type', 'application/dicom');
  response.setHeader('Content-Length', end - start);
  if (match) {
    response.statusCode = 206;
    response.setHeader(
      'Content-Range',
      `bytes ${start}-${end - 1}/${bytes.length}`
    );
  }
  response.end(bytes.subarray(start, end));
}

export async function startDicomPages({
  kinds = ['corpus'],
  fixtures = {},
} = {}) {
  const serveFixture = (ranged) => (request, response) => {
    const name = decodeURIComponent(request.url?.slice(1) ?? '');
    if (!Object.hasOwn(fixtures, name)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (ranged) response.setHeader('Accept-Ranges', 'bytes');
    serveDicom(
      fixtures[name],
      ranged ? request.headers.range : undefined,
      response
    );
  };
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.tmp/dicom-browser-'));
  const servers = [];
  /** @type {Record<string, string>} */
  const urls = {};
  try {
    for (const kind of kinds) {
      const outDir = resolve(directory, kind);
      await buildPage(kind, outDir);
      const server = await preview({
        configFile: false,
        root,
        build: { outDir },
        preview: { host: '127.0.0.1', port: 0 },
        plugins: [
          {
            name: 'synthetic-dicom-source',
            configurePreviewServer(instance) {
              instance.middlewares.use('/corpus-data', serveFixture(true));
              // A server that ignores Range answers every read with the file.
              instance.middlewares.use('/unranged-data', serveFixture(false));
            },
          },
        ],
      });
      servers.push(server);
      urls[kind] = `${server.resolvedUrls.local[0]}${kind}.html`;
    }
  } catch (error) {
    await Promise.all(servers.map((server) => server.close()));
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    urls,
    async close() {
      await Promise.all(servers.map((server) => server.close()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
