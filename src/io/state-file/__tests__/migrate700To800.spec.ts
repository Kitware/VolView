import { describe, expect, it } from 'vitest';

import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { omit } from '@/src/utils';

const tumor = {
  id: 'tumor',
  name: 'Tumor',
  color: [255, 10, 20, 128],
  visible: false,
  locked: true,
  fillOpacity: 0.4,
  outlineOpacity: 0.8,
  strokeWidth: 3,
};
const planned = {
  id: 'planned',
  name: 'Planned',
  color: [0, 255, 0, 255],
};

const migrate = (overrides: Record<string, unknown> = {}) =>
  ManifestSchema.parse(
    migrateManifest(
      JSON.stringify({
        version: '7.0.0',
        dataSources: [
          { id: 1, type: 'uri', uri: 'https://example.test/a.nrrd' },
          { id: 2, type: 'uri', uri: 'https://example.test/b.nrrd' },
        ],
        datasets: [
          { id: 'a', dataSourceId: 1 },
          { id: 'b', dataSourceId: 2 },
        ],
        segments: [tumor, planned],
        selectedSegment: tumor.id,
        ...overrides,
      })
    )
  );

const mask = (id: string) => ({
  id,
  segmentId: tumor.id,
  representations: {
    labelmap: { path: `${id}.vti`, extent: [0, 1, 0, 1, 0, 1] },
  },
});

describe('7.0.0 image segment ownership migration', () => {
  it('splits shared identities and preserves each image catalog and selection', () => {
    const migrated = migrate({
      segmentations: ['a', 'b'].map((parentImage) => ({
        id: `segmentation-${parentImage}`,
        name: parentImage,
        parentImage,
        masks: [mask(`mask-${parentImage}`)],
        order: [`mask-${parentImage}`],
      })),
    });

    expect(migrated.version).toBe('8.0.0');
    expect(migrated).not.toHaveProperty('selectedSegment');
    const [a, b] = migrated.imageSegmentSets!;
    expect(a.imageId).toBe('a');
    expect(b.imageId).toBe('b');
    expect(a.segmentIds).toHaveLength(2);
    expect(b.segmentIds).toHaveLength(2);
    expect(new Set([...a.segmentIds, ...b.segmentIds]).size).toBe(4);
    expect(a.selectedSegmentId).toBe(a.segmentIds[0]);
    expect(b.selectedSegmentId).toBe(b.segmentIds[0]);
    for (const set of [a, b]) {
      expect(
        set.segmentIds.map(
          (id) => migrated.segments!.find((segment) => segment.id === id)?.name
        )
      ).toEqual(['Tumor', 'Planned']);
      expect(
        migrated.segments!.find((segment) => segment.id === set.segmentIds[0])
      ).toMatchObject({ ...tumor, id: set.segmentIds[0] });
    }
    expect(
      migrated.segmentations!.map((segmentation) => ({
        segmentId: segmentation.masks[0].segmentId,
        binding: segmentation.masks[0].representations.labelmap,
      }))
    ).toEqual([
      {
        segmentId: a.segmentIds[0],
        binding: mask('mask-a').representations.labelmap,
      },
      {
        segmentId: b.segmentIds[0],
        binding: mask('mask-b').representations.labelmap,
      },
    ]);
  });

  it('remaps each annotation kind through the shape image', () => {
    const geometry = {
      frameOfReference: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1] },
      slice: 0,
      firstPoint: [0, 0, 0],
      secondPoint: [1, 1, 0],
      points: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
      ],
    };
    const tools = Object.fromEntries(
      ['rulers', 'rectangles', 'polygons'].map((key) => [
        key,
        {
          tools: ['a', 'b'].map((imageID) => ({
            ...geometry,
            imageID,
            segmentId: tumor.id,
          })),
        },
      ])
    );
    const migrated = migrate({ tools });
    for (const key of ['rulers', 'rectangles', 'polygons'] as const) {
      expect(
        migrated.tools![key]!.tools.map(({ segmentId }) => segmentId)
      ).toEqual(
        migrated.imageSegmentSets!.map(
          ({ selectedSegmentId }) => selectedSegmentId
        )
      );
    }
  });

  it('leaves images uninitialized when the legacy catalog is empty', () => {
    const migrated = migrate({ segments: [], selectedSegment: 'missing' });
    expect(migrated.imageSegmentSets).toEqual([]);
  });

  it('preserves repeated ids for restore reporting without changing references', () => {
    const migrated = migrate({
      segments: [tumor, { ...tumor, name: 'Repeated' }],
    });
    const [a, b] = migrated.imageSegmentSets!;
    expect(a.segmentIds).toHaveLength(1);
    expect(b.segmentIds).toHaveLength(1);
    expect(migrated.segments!.map(({ id }) => id)).toEqual([
      a.segmentIds[0],
      a.segmentIds[0],
      b.segmentIds[0],
      b.segmentIds[0],
    ]);
  });

  it('keeps a missing reference from aliasing a generated segment identity', () => {
    const missingId = 'image-1-segment-1';
    const migrated = migrate({
      segmentations: [
        {
          id: 'seg-a',
          name: 'a',
          parentImage: 'a',
          order: ['broken'],
          masks: [{ ...mask('broken'), segmentId: missingId }],
        },
      ],
    });
    expect(migrated.segmentations![0].masks[0].segmentId).toBe(missingId);
    expect(migrated.segments!.some(({ id }) => id === missingId)).toBe(false);
  });

  it('retains an image-free catalog as seed defaults', () => {
    const migrated = migrate({ datasets: [], dataSources: [] });
    expect(migrated.imageSegmentSets).toEqual([]);
    expect(migrated.segments).toEqual([]);
    expect(migrated.seedSegmentDefaults).toEqual(
      [
        { ...tumor, id: undefined },
        { ...planned, id: undefined, visible: true, locked: false },
      ].map((definition) => omit(definition, ['id']))
    );
  });

  it('uses legacy URI dataset identities when datasets were not saved', () => {
    const migrated = migrate({ datasets: undefined });
    expect(migrated.imageSegmentSets!.map(({ imageId }) => imageId)).toEqual([
      '1',
      '2',
    ]);
  });

  it('leaves an 8.0.0 archive unchanged, including a deliberately empty set', () => {
    const manifest = migrate({ segments: [] });
    manifest.imageSegmentSets = [{ imageId: 'a', segmentIds: [] }];
    expect(migrateManifest(JSON.stringify(manifest))).toEqual(manifest);
  });
});
