import { describe, expect, it } from 'vitest';

import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';

// ---------------------------------------------------------------------------
// 7.0.0 -> 7.1.0 adds display state to segments and segmentations. The fields
// are optional with zod defaults, so the step only stamps the version.
// ---------------------------------------------------------------------------

const manifest700 = () => ({
  version: '7.0.0',
  dataSources: [{ id: 1, type: 'uri', uri: '/ct.nrrd' }],
  datasets: [{ id: 'img-1', dataSourceId: 1 }],
  segmentationArtifacts: [
    { id: 'a-1', parentImage: 'img-1', name: 'Group 1', path: 'group1.vti' },
  ],
  segmentations: [
    {
      id: 'seg-1',
      name: 'CT',
      parentImage: 'img-1',
      segments: [
        {
          id: 's-1',
          name: 'Tumor',
          color: [255, 0, 0, 255],
          visible: true,
          locked: false,
          representations: {
            labelmap: {
              artifactId: 'a-1',
              labelValue: 1,
              extent: [0, 3, 0, 3, 0, 1],
            },
          },
        },
      ],
      order: ['s-1'],
      activeSegment: 's-1',
    },
  ],
});

describe('7.0.0 -> 7.1.0 migration', () => {
  it('stamps the version and transforms nothing else', () => {
    const before = manifest700();
    const migrated = migrateManifest(JSON.stringify(before)) as any;

    expect(migrated.version).toBe('7.1.0');
    expect({ ...migrated, version: before.version }).toEqual(before);
  });

  it('lands on the version the serializer writes', () => {
    const migrated = migrateManifest(JSON.stringify(manifest700())) as any;

    expect(MANIFEST_VERSION).toBe('7.1.0');
    expect(migrated.version).toBe(MANIFEST_VERSION);
  });

  it('leaves a current manifest untouched', () => {
    const current = { ...manifest700(), version: '7.1.0' };
    const migrated = migrateManifest(JSON.stringify(current)) as any;

    expect(migrated).toEqual(current);
  });

  it('runs after the 6.4.0 step, so an older manifest does not stop at 7.0.0', () => {
    const old = JSON.stringify({
      version: '6.4.0',
      dataSources: [],
      segmentGroups: [
        {
          id: 'sg-1',
          path: 'group1.vti',
          metadata: {
            name: 'Painted',
            parentImage: 'img-1',
            segments: { order: [], byValue: {} },
          },
        },
      ],
    });
    const migrated = migrateManifest(old) as any;

    expect(migrated.version).toBe('7.1.0');
    expect(migrated.segmentationArtifacts).toHaveLength(1);
  });

  it('parses with default display state after migrating', () => {
    const migrated = migrateManifest(JSON.stringify(manifest700()));
    const parsed = ManifestSchema.parse(migrated);
    const segmentation = parsed.segmentations![0];

    expect(segmentation.fillOpacity).toBe(1);
    expect(segmentation.outlineOpacity).toBe(1);
    expect(segmentation.outlineThickness).toBe(2);
    expect(segmentation.segments[0].fillOpacity).toBe(1);
    expect(segmentation.segments[0].outlineOpacity).toBe(1);
  });
});
