import { describe, expect, it } from 'vitest';

import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

describe('legacy manifest migration', () => {
  it('migrates a 6.3.0 manifest to the current version, converting segment groups', () => {
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
    const migrated = migrateManifest(old) as any;

    expect(migrated.version).toBe(MANIFEST_VERSION);
    expect(migrated.segmentGroups).toBeUndefined();
    expect(migrated.segmentationArtifacts).toHaveLength(1);
    expect(migrated.segmentationArtifacts[0]).toMatchObject({
      id: 'sg-1',
      dataSourceId: 7,
      parentImage: 'img-1',
      name: 'Painted',
    });
    // An empty descriptor block is a KNOWN empty catalog, not a pending decode.
    expect(migrated.segmentationArtifacts[0].pendingDecode).toBeFalsy();
    // An old manifest lacking `source` still validates (additive-optional).
    expect(() => ManifestSchema.parse(migrated)).not.toThrow();
  });
});
