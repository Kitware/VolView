import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { generateJsonSchemas, GENERATED_SCHEMA_NAMES } from '../schema-json';
import { validateTaskSpecSemantics } from '../task-spec';
import { loadFixture } from './loadFixtures';

// The single-source guard: the checked-in JSON Schemas the backend consumes
// must equal what the zod source generates right now. If a schema changes and
// the generated artifact is not regenerated
// (`npx tsx backend-contract/scripts/generate-json-schema.ts`), this fails.

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = resolve(here, '..', '..', 'generated');

describe('generated JSON Schemas are in sync with the zod source', () => {
  const fresh = generateJsonSchemas();

  it.each(GENERATED_SCHEMA_NAMES)('%s.schema.json is up to date', (name) => {
    const path = resolve(generatedDir, `${name}.schema.json`);
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk).toEqual(fresh[name]);
  });

  it('rejects semantic negative fixtures in the required backend validation pass', () => {
    const fixture = loadFixture('negative/constraint-violation.json');
    const structuralSchema = z.fromJSONSchema(fresh['task-spec']);

    // Standard JSON Schema cannot compare sibling instance properties.
    expect(structuralSchema.safeParse(fixture).success).toBe(true);
    expect(validateTaskSpecSemantics(fixture)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'default must be <= max',
          path: ['parameters', 1, 'default'],
        }),
      ])
    );
  });
});
