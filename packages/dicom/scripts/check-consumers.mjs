import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const packageRoot = resolve(root, 'packages/dicom');
const fixture = resolve(root, 'tests/fixtures/dicom-consumer');
const require = createRequire(import.meta.url);

const forbiddenModule = (id, kind) => {
  const path = id.replaceAll('\\', '/');
  return (
    path.startsWith(`${root.replaceAll('\\', '/')}/src/`) ||
    /\/node_modules\/(vue|pinia|@vue\/|@vueuse\/)/.test(path) ||
    (kind === 'core' && path.includes('/node_modules/@kitware/vtk.js/'))
  );
};

export async function buildConsumer(kind, outDir) {
  await build({
    configFile: false,
    root: fixture,
    publicDir: false,
    base: './',
    resolve: {
      alias: {
        '@volview/dicom/core': resolve(packageRoot, 'dist/core.js'),
        '@volview/dicom/vtk': resolve(packageRoot, 'dist/vtk.js'),
      },
    },
    plugins: [
      {
        name: 'independent-dicom-consumer',
        generateBundle() {
          for (const id of this.getModuleIds()) {
            if (forbiddenModule(id, kind))
              this.error(`Unexpected ${kind} consumer dependency: ${id}`);
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
  await cp(resolve(packageRoot, 'dist/assets'), resolve(outDir, 'assets'), {
    recursive: true,
  });
}

async function checkDeclarations(directory) {
  const config = {
    extends: resolve(root, 'tsconfig.json'),
    compilerOptions: {
      baseUrl: root,
      types: ['node'],
      typeRoots: [resolve(root, 'node_modules/@types')],
      paths: {
        '@volview/dicom/core': ['packages/dicom/dist/core/index.d.ts'],
        '@volview/dicom/vtk': ['packages/dicom/dist/vtk/index.d.ts'],
      },
    },
    include: [`${fixture}/*.ts`],
    exclude: [],
  };
  const configPath = resolve(directory, 'tsconfig.json');
  await writeFile(configPath, JSON.stringify(config));
  execFileSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', configPath],
    { cwd: root, stdio: 'inherit' }
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const directory = await mkdtemp(resolve(tmpdir(), 'dicom-consumers-'));
  try {
    await checkDeclarations(directory);
    for (const kind of ['core', 'vtk'])
      await buildConsumer(kind, resolve(directory, kind));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
