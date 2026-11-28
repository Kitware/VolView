import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEST_DATASETS, type TestDataset } from './datasets.ts';
import extendedCorpus from './dicomExtendedCorpus.json' with { type: 'json' };
import { projectRoot } from './e2eTestUtils.ts';

// Node built-ins only, so CI can warm the dataset cache by running this file
// with node, without installing dependencies.

// Kept across runs, and across CI runs by the workflow cache.
export const DATASET_CACHE = path.resolve(projectRoot(), '.tmp/datasets');

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

const failure = (dataset: TestDataset, reason: string) =>
  new Error(
    `Could not download test dataset ${dataset.name} from ${dataset.url}: ${reason}`
  );

/** The body, or the reason the source did not answer with one. */
async function fetchBody(dataset: TestDataset) {
  try {
    const response = await fetch(dataset.url);
    if (!response.ok) return `HTTP ${response.status}`;
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    return (err as Error).message;
  }
}

const checked = (dataset: TestDataset, data: Buffer) => {
  const actual = sha256(data);
  if (actual !== dataset.sha256)
    throw failure(dataset, `sha256 is ${actual}, expected ${dataset.sha256}`);
  return data;
};

const savePathOf = (dataset: Pick<TestDataset, 'name'>) =>
  path.join(DATASET_CACHE, dataset.name);

// A cached file is only good while it is the file this checkout names.
export const isCached = (dataset: Pick<TestDataset, 'name' | 'sha256'>) =>
  fs.existsSync(savePathOf(dataset)) &&
  sha256(fs.readFileSync(savePathOf(dataset))) === dataset.sha256;

// Rename into place so an interrupted write never looks cached.
function save(dataset: TestDataset, data: Buffer) {
  fs.writeFileSync(`${savePathOf(dataset)}.part`, data);
  fs.renameSync(`${savePathOf(dataset)}.part`, savePathOf(dataset));
}

/**
 * The only place the suite reaches the internet. One attempt per file: a slow
 * or missing host stops here and never shows up as a failing spec.
 */
export async function downloadDatasets() {
  fs.mkdirSync(DATASET_CACHE, { recursive: true });
  await Promise.all(
    TEST_DATASETS.map(async (dataset) => {
      if (isCached(dataset)) return;
      const body = await fetchBody(dataset);
      if (typeof body === 'string') throw failure(dataset, body);
      save(dataset, checked(dataset, body));
    })
  );
}

/**
 * The extended DICOM corpus. An unreachable source is skipped and its file
 * named in the result; a changed file still fails, since its entry is wrong.
 */
export async function downloadExtendedCorpus() {
  fs.mkdirSync(DATASET_CACHE, { recursive: true });
  const unreachable = await Promise.all(
    extendedCorpus.datasets.map(async (dataset) => {
      if (isCached(dataset)) return [];
      const body = await fetchBody(dataset);
      if (typeof body === 'string') return [`${dataset.name} (${body})`];
      save(dataset, checked(dataset, body));
      return [];
    })
  );
  return unreachable.flat();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await downloadDatasets();
  if (process.argv.includes('--extended')) {
    const unreachable = await downloadExtendedCorpus();
    if (unreachable.length)
      console.warn(
        `Unreachable extended corpus files:\n${unreachable.join('\n')}`
      );
  }
}
