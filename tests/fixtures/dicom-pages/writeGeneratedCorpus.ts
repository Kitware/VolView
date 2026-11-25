/**
 * Writes the generated corpus files into the dataset cache so the Python
 * reference can read them: npx tsx tests/fixtures/dicom-pages/writeGeneratedCorpus.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATASET_CACHE } from '../../downloadDatasets';
import { GENERATED_CORPUS, generatedName } from './generatedCorpus';

mkdirSync(DATASET_CACHE, { recursive: true });
for (const [generator, build] of Object.entries(GENERATED_CORPUS)) {
  const path = join(DATASET_CACHE, generatedName(generator));
  writeFileSync(path, build());
  console.log(path);
}
