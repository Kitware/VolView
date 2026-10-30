import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(packageRoot, '../..');
const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  await readFile(resolve(packageRoot, 'package.json'), 'utf8')
);
const dependencies = Object.keys({
  ...manifest.dependencies,
  ...manifest.peerDependencies,
});
const external = (id) =>
  dependencies.some((name) => id === name || id.startsWith(`${name}/`));

await build({
  configFile: false,
  root: packageRoot,
  publicDir: false,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: {
        core: resolve(packageRoot, 'core/index.ts'),
        vtk: resolve(packageRoot, 'vtk/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, entry) => `${entry}.js`,
    },
    rollupOptions: { external },
  },
  worker: { format: 'es' },
});
execFileSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '-p',
    'packages/dicom/tsconfig.build.json',
  ],
  { cwd: root, stdio: 'inherit' }
);

const moduleRoot = (name) => resolve(dirname(require.resolve(name)), '..');
const assets = resolve(packageRoot, 'dist/assets');
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
  if (/^gdcm-read-image\.(js|wasm|wasm\.zst)$/.test(name)) {
    await cp(resolve(pipelines, name), resolve(assets, 'image-io', name));
  }
}
