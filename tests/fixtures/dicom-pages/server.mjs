import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

// Pages exercise the DICOM module alone, so nothing from the app or its UI
// frameworks may enter their bundles.
const forbiddenModule = (id, kind) => {
  const path = id.replaceAll('\\', '/');
  return (
    path.startsWith(`${root.replaceAll('\\', '/')}src/`) ||
    /\/node_modules\/(vue|pinia|@vue\/|@vueuse\/)/.test(path) ||
    (kind === 'core' && path.includes('/node_modules/@kitware/vtk.js/'))
  );
};

const moduleRoot = (name) => resolve(dirname(require.resolve(name)), '..');

async function copyItkAssets(assets) {
  await mkdir(resolve(assets, 'image-io'), { recursive: true });
  await cp(
    resolve(
      moduleRoot('itk-wasm'),
      'dist/pipeline/web-workers/bundles/itk-wasm-pipeline.min.worker.js'
    ),
    resolve(assets, 'itk-wasm-pipeline.min.worker.js')
  );
  const pipelines = resolve(moduleRoot('@itk-wasm/image-io'), 'dist/pipelines');
  for (const name of await readdir(pipelines)) {
    if (/^gdcm-read-image\.(js|wasm|wasm\.zst)$/.test(name))
      await cp(resolve(pipelines, name), resolve(assets, 'image-io', name));
  }
}

async function buildPage(kind, outDir) {
  await build({
    configFile: false,
    root: fixture,
    publicDir: false,
    base: './',
    logLevel: 'warn',
    resolve: { alias: [{ find: '@', replacement: root.replace(/\/$/, '') }] },
    plugins: [
      {
        name: 'dicom-module-only',
        generateBundle() {
          for (const id of this.getModuleIds()) {
            if (forbiddenModule(id, kind))
              this.error(`Unexpected ${kind} page dependency: ${id}`);
          }
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: resolve(fixture, `${kind}.html`) },
    },
    worker: { format: 'es' },
  });
  await copyItkAssets(resolve(outDir, 'assets'));
}

function serveDicom(bytes, request, response) {
  const match = /^bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2]
    ? Math.min(bytes.length, Number(match[2]) + 1)
    : bytes.length;
  response.setHeader('Content-Type', 'application/dicom');
  response.setHeader('Accept-Ranges', 'bytes');
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

export async function startDicomPages(
  bytes,
  { kinds = ['core', 'vtk'], fixtures = {} } = {}
) {
  await mkdir(resolve(root, '.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.tmp/dicom-browser-'));
  const servers = [];
  /** @type {Record<string, string>} */
  const urls = {};
  try {
    for (const kind of kinds) {
      const outDir = resolve(directory, kind);
      await buildPage(kind, outDir);
      const pipelineWorker = await readFile(
        resolve(outDir, 'assets/itk-wasm-pipeline.min.worker.js')
      );
      let workerRequests = 0;
      const server = await preview({
        configFile: false,
        root,
        build: { outDir },
        preview: { host: '127.0.0.1', port: 0 },
        plugins: [
          {
            name: 'synthetic-dicom-source',
            configurePreviewServer(instance) {
              instance.middlewares.use(
                '/recovering-worker.js',
                (_request, response) => {
                  response.setHeader('Cache-Control', 'no-store');
                  response.setHeader('Content-Type', 'text/javascript');
                  if (workerRequests++ === 0) {
                    response.statusCode = 503;
                    response.end('temporary worker script failure');
                  } else {
                    response.end(pipelineWorker);
                  }
                }
              );
              instance.middlewares.use('/fixture.dcm', (request, response) => {
                serveDicom(bytes, request, response);
              });
              instance.middlewares.use('/corpus-data', (request, response) => {
                const name = decodeURIComponent(request.url?.slice(1) ?? '');
                if (!Object.hasOwn(fixtures, name)) {
                  response.statusCode = 404;
                  response.end();
                  return;
                }
                serveDicom(fixtures[name], request, response);
              });
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
