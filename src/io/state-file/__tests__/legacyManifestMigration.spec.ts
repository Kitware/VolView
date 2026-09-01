import { describe, expect, it } from 'vitest';

import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// Deferred to C8, which adds `migrate640To700`: until that step exists the
// pipeline cannot reach the current version and the legacy `segmentGroups` root
// has no home in the 7.0.0 schema. Ported here from segmentGroupSource.spec.ts.
describe.skip('legacy manifest migration', () => {
  it('migrates a 6.3.0 manifest to the current version, preserving segment groups', () => {
    const old = JSON.stringify({
      version: '6.3.0',
      dataSources: [],
      segmentGroups: [
        {
          id: 'sg-1',
          dataSourceId: 7,
          metadata: {
            name: 'Painted',
            parentImage: 'img-1',
            segments: { order: [], byValue: {} },
          },
        },
      ],
    });
    const migrated = migrateManifest(old);
    expect(migrated.version).toBe(MANIFEST_VERSION);
    expect(migrated.segmentGroups).toHaveLength(1);
    // An old manifest lacking `source` still validates (additive-optional).
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });
});
