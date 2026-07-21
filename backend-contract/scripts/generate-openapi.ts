// ---------------------------------------------------------------------------
// Writes the published OpenAPI document to
// `backend-contract/generated/openapi.json`. Run with the repo's TS runner:
//
//   npx tsx backend-contract/scripts/generate-openapi.ts
//
// Single source: the wire component schemas are injected from the SAME
// zod-generated JSON Schemas the backend validates against, so the OpenAPI can
// never drift from the normative zod definition. `processing/__tests__/openapi.spec.ts`
// guards the checked-in output against drift; it ships in the `volview` package
// (alongside the fixtures + generated schemas), where girder_volview reads it.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildOpenApiDocument } from '../processing/openapi';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'generated');
mkdirSync(outDir, { recursive: true });

const path = resolve(outDir, 'openapi.json');
writeFileSync(path, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${path}`);
