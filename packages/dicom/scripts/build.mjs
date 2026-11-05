import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(packageRoot, '../..');
const require = createRequire(import.meta.url);
const outDir = resolve(packageRoot, process.argv[2] ?? 'dist');
const manifest = JSON.parse(
  await readFile(resolve(packageRoot, 'package.json'), 'utf8')
);
const dependencies = Object.keys({
  ...manifest.dependencies,
  ...manifest.peerDependencies,
});
const external = (id) =>
  dependencies.some((name) => id === name || id.startsWith(`${name}/`));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === '__tests__' ? [] : sourceFiles(file);
      return entry.name.endsWith('.ts') && !/\.(d|worker)\.ts$/.test(entry.name)
        ? [file]
        : [];
    })
  );
  return files.flat();
}

const sources = (
  await Promise.all(
    ['core', 'vtk'].map((dir) => sourceFiles(resolve(packageRoot, dir)))
  )
).flat();

await build({
  configFile: false,
  root: packageRoot,
  publicDir: false,
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: Object.fromEntries(
        sources.map((file) => [
          relative(packageRoot, file)
            .replaceAll('\\', '/')
            .replace(/\.ts$/, ''),
          file,
        ])
      ),
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
    '--outDir',
    outDir,
  ],
  { cwd: root, stdio: 'inherit' }
);

const moduleRoot = (name) => resolve(dirname(require.resolve(name)), '..');
const assets = resolve(outDir, 'assets');
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
