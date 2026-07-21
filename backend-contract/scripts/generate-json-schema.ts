// ---------------------------------------------------------------------------
// Writes the generated JSON Schemas (the single-source parity artifact) to
// `backend-contract/generated/`. Run with the repo's TypeScript runner:
//
//   npx tsx backend-contract/scripts/generate-json-schema.ts
//
// The checked-in output is guarded against drift from the zod source by
// `processing/__tests__/generated-schema.spec.ts`; it ships in the `volview`
// package, where girder_volview's conformance tests read it.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateJsonSchemas } from '../processing/schema-json';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'generated');
mkdirSync(outDir, { recursive: true });

const schemas = { ...generateJsonSchemas() };
Object.entries(schemas).forEach(([name, schema]) => {
  const path = resolve(outDir, `${name}.schema.json`);
  writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote ${path}`);
});
