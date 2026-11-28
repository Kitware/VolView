import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer } from 'node:net';
import { AUX_PORT } from './e2ePorts';
import { TEST_DATASETS } from './datasets';
import {
  DATASET_CACHE,
  downloadDatasets,
  downloadExtendedCorpus,
} from './downloadDatasets';
import { BROWSER_DOWNLOADS, TEMP_DIR } from './e2eRun';

// Windows refuses to unlink a file while a handle is open, so give the static
// server's teardown a moment to catch up.
export const removeDir = (dir: string) =>
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });

const inUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = createServer()
      .once('error', (err: NodeJS.ErrnoException) =>
        resolve(err.code === 'EADDRINUSE')
      )
      .once('listening', () => server.close(() => resolve(false)));
    server.listen(port);
  });

/** Serves a cached dataset at `/tmp/<name>` without each run holding a copy. */
function linkCachedDataset(name: string) {
  const runPath = path.join(TEMP_DIR, name);
  try {
    fs.linkSync(path.join(DATASET_CACHE, name), runPath);
  } catch {
    // A hard link needs one filesystem; a copy always works.
    fs.copyFileSync(path.join(DATASET_CACHE, name), runPath);
  }
}

// Runs after the webServer has claimed the main port, so the wipe below never
// reaches a directory another run on that port is using.
export default async function globalSetup() {
  if (await inUse(AUX_PORT)) {
    throw new Error(
      `E2E port already in use: ${AUX_PORT} (VOLVIEW_E2E_AUX_PORT). Set it to a free port to run anyway.`
    );
  }

  removeDir(TEMP_DIR);
  fs.mkdirSync(BROWSER_DOWNLOADS, { recursive: true });

  await downloadDatasets();
  if (process.env.DICOM_CORPUS === 'extended') {
    const unreachable = await downloadExtendedCorpus();
    if (unreachable.length)
      console.warn(
        `Skipping unreachable extended corpus files:\n${unreachable.join('\n')}`
      );
  }
  TEST_DATASETS.forEach(({ name }) => linkCachedDataset(name));
}
