import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { buildConsumer } from '../../../packages/dicom/scripts/check-consumers.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export async function startDicomConsumerFixtures(bytes) {
  execFileSync(process.execPath, ['packages/dicom/scripts/build.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  const directory = await mkdtemp(resolve(tmpdir(), 'dicom-browser-'));
  const servers = [];
  /** @type {Record<string, string>} */
  const urls = {};
  try {
    for (const kind of ['core', 'vtk']) {
      const outDir = resolve(directory, kind);
      await buildConsumer(kind, outDir);
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
                const match = /^bytes=(\d+)-/.exec(request.headers.range ?? '');
                const start = match ? Number(match[1]) : 0;
                response.setHeader('Content-Type', 'application/dicom');
                response.setHeader('Accept-Ranges', 'bytes');
                response.setHeader('Content-Length', bytes.length - start);
                if (match) {
                  response.statusCode = 206;
                  response.setHeader(
                    'Content-Range',
                    `bytes ${start}-${bytes.length - 1}/${bytes.length}`
                  );
                }
                response.end(bytes.subarray(start));
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
