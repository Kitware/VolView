import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DATASET_RELEASE,
  TEST_DATASETS,
  type TestDataset,
} from './datasets.ts';
import { projectRoot } from './e2eTestUtils.ts';

// Node built-ins only, so CI can warm the dataset cache by running this file
// with node, without installing dependencies.

// Kept across runs, and across CI runs by the workflow cache.
export const DATASET_CACHE = path.resolve(projectRoot(), '.tmp/datasets');

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

async function fetchDataset(dataset: TestDataset) {
  const url = `${DATASET_RELEASE}/${dataset.name}`;
  const fail = (reason: string) =>
    new Error(
      `Could not download test dataset ${dataset.name} from ${url}: ${reason}`
    );

  const response = await fetch(url).catch((err: Error) => {
    throw fail(err.message);
  });
  if (!response.ok) throw fail(`HTTP ${response.status}`);

  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== dataset.sha256) {
    throw fail(`sha256 is ${actual}, expected ${dataset.sha256}`);
  }
  return data;
}

/**
 * The only place the suite reaches the internet. One attempt per file: a slow
 * or missing host stops here and never shows up as a failing spec.
 */
export async function downloadDatasets() {
  fs.mkdirSync(DATASET_CACHE, { recursive: true });
  await Promise.all(
    TEST_DATASETS.map(async (dataset) => {
      const savePath = path.join(DATASET_CACHE, dataset.name);
      // A cached file is only good while it is the file this checkout names.
      const cached =
        fs.existsSync(savePath) &&
        sha256(fs.readFileSync(savePath)) === dataset.sha256;
      if (cached) return;
      // Rename into place so an interrupted write never looks cached.
      fs.writeFileSync(`${savePath}.part`, await fetchDataset(dataset));
      fs.renameSync(`${savePath}.part`, savePath);
    })
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await downloadDatasets();
}
