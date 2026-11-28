import { describe, expect, it } from 'vitest';

import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { DEFAULT_SEGMENTATION_DISPLAY } from '@/src/segmentation/model';

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
  visible: true,
  locked: false,
};

const migrateLegacy = (overrides: Record<string, unknown> = {}) =>
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
  );

const migrateWith = (overrides: Record<string, unknown> = {}) => {
  const { manifest, migration } = migrateLegacy(overrides);
  return { manifest: ManifestSchema.parse(manifest), migration };
};

const migrate = (overrides: Record<string, unknown> = {}) =>
  migrateWith(overrides).manifest;

const labelmap = (id: string) => ({
  path: `${id}.vti`,
  extent: [0, 1, 0, 1, 0, 1],
});

const mask = (id: string, segmentId = tumor.id) => ({
  id,
  segmentId,
  representations: { labelmap: labelmap(id) },
});

const segmentationOn = (
  parentImage: string,
  masks: Array<{ id: string }>,
  fields: Record<string, unknown> = {}
) => ({
  id: `segmentation-${parentImage}`,
  name: '',
  parentImage,
  masks,
  order: masks.map(({ id }) => id),
  ...fields,
});

const entryOf = (manifest: ReturnType<typeof migrate>, imageId: string) =>
  manifest.imageSegments!.find((entry) => entry.imageId === imageId)!;

describe('7.0.0 to 8.0.0 migration', () => {
  it('copies the catalog under every image with its ids, masks and selection', () => {
    const migrated = migrate({
      segmentations: ['a', 'b'].map((parentImage) =>
        segmentationOn(parentImage, [mask(`mask-${parentImage}`)])
      ),
    });

    expect(migrated.version).toBe('9.0.0');
    expect(migrated).not.toHaveProperty('selectedSegment');
    expect(migrated).not.toHaveProperty('segments');
    expect(migrated).not.toHaveProperty('segmentations');
    expect(
      migrated.imageSegments!.map(
        ({ imageId, selectedSegmentId, segments }) => ({
          imageId,
          selectedSegmentId,
          segments,
        })
      )
    ).toEqual(
      ['a', 'b'].map((imageId) => ({
        imageId,
        selectedSegmentId: tumor.id,
        segments: [
          { ...tumor, labelmap: labelmap(`mask-${imageId}`) },
          planned,
        ],
      }))
    );
  });

  it('keeps annotation and en face references as saved', () => {
    const tools = {
      rulers: {
        tools: ['a', 'b'].map((imageID) => ({
          imageID,
          segmentId: tumor.id,
          frameOfReference: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1] },
          slice: 0,
          firstPoint: [0, 0, 0],
          secondPoint: [1, 1, 0],
        })),
      },
    };
    const viewByID = {
      view: {
        id: 'view',
        type: 'EnFace',
        name: 'En face',
        config: {
          a: {
            enFace: {
              axis: 1,
              method: 'mean',
              depthStart: 0,
              depthEnd: null,
              segmentProjections: {
                [planned.id]: { visible: true, thresholdMicrons: null },
              },
            },
          },
        },
      },
    };
    const migrated = migrate({ tools, viewByID });

    expect(
      migrated.tools!.rulers!.tools.map(({ segmentId }) => segmentId)
    ).toEqual([tumor.id, tumor.id]);
    expect(
      Object.keys(migrated.viewByID!.view.config!.a.enFace!.segmentProjections)
    ).toEqual([planned.id]);
  });

  it('leaves images without a set when the legacy catalog is empty', () => {
    const migrated = migrate({ segments: [], selectedSegment: 'missing' });
    expect(migrated.imageSegments).toEqual([]);
  });

  it('keeps the first row of a repeated catalog id', () => {
    const migrated = migrate({
      segments: [tumor, { ...tumor, name: 'Repeated' }],
    });
    expect(
      migrated.imageSegments!.map(({ segments }) =>
        segments.map(({ name }) => name)
      )
    ).toEqual([['Tumor'], ['Tumor']]);
  });

  it('keeps a segmented image its display when the catalog is empty', () => {
    const migrated = migrate({
      segments: [],
      segmentations: [segmentationOn('a', [], { fillOpacity: 0.4 })],
    });
    expect(migrated.imageSegments).toEqual([
      {
        imageId: 'a',
        display: { ...DEFAULT_SEGMENTATION_DISPLAY, fillOpacity: 0.4 },
        segments: [],
      },
    ]);
  });

  it('drops an image-free catalog', () => {
    expect(migrate({ datasets: [], dataSources: [] }).imageSegments).toEqual(
      []
    );
  });

  it('uses legacy URI dataset identities when datasets were not saved', () => {
    const migrated = migrate({ datasets: undefined });
    expect(migrated.imageSegments!.map(({ imageId }) => imageId)).toEqual([
      '1',
      '2',
    ]);
  });

  it('leaves an 8.0.0 manifest unchanged, including a deliberately empty set', () => {
    const manifest = migrate({ segments: [] });
    manifest.imageSegments = [{ imageId: 'a', segments: [] }];
    expect(migrateManifest(JSON.stringify(manifest)).manifest).toEqual(
      manifest
    );
  });

  it('puts each listed mask on its segment, in catalog order', () => {
    const { manifest } = migrateWith({
      segmentations: [
        {
          ...segmentationOn('a', [
            mask('tumor-mask'),
            mask('planned-mask', planned.id),
          ]),
          order: ['planned-mask', 'tumor-mask'],
        },
      ],
    });

    expect(
      entryOf(manifest, 'a').segments.map(({ id, labelmap: binding }) => ({
        id,
        binding,
      }))
    ).toEqual([
      { id: tumor.id, binding: labelmap('tumor-mask') },
      { id: planned.id, binding: labelmap('planned-mask') },
    ]);
    expect(
      entryOf(manifest, 'b').segments.some(({ labelmap: bound }) => bound)
    ).toBe(false);
  });

  it('keeps an artifact-bound mask on its segment for restore to split', () => {
    const binding = {
      artifactId: 'labels',
      sourceValue: 3,
      extent: [0, -1, 0, -1, 0, -1],
    };
    const { manifest } = migrateWith({
      segmentations: [
        segmentationOn('a', [
          {
            id: 'from-artifact',
            segmentId: tumor.id,
            representations: { labelmap: binding },
          } as any,
        ]),
      ],
      segmentationArtifacts: [
        { id: 'labels', parentImage: 'a', name: 'labels', path: 'labels.vti' },
      ],
    });

    expect(entryOf(manifest, 'a').segments[0].labelmap).toEqual(binding);
    expect(manifest.segmentationArtifacts).toHaveLength(1);
  });

  it('reports each mask it cannot carry', () => {
    const named = mask('named');
    const pathOnly = mask('path-only', 'unknown');
    const fromArtifact = {
      id: 'from-artifact',
      segmentId: 'unknown',
      representations: {
        labelmap: {
          artifactId: 'labels',
          sourceValue: 3,
          extent: [0, -1, 0, -1, 0, -1],
        },
      },
    };
    const bare = { id: 'bare', segmentId: 'unknown', representations: {} };
    const { manifest, migration } = migrateWith({
      segmentations: [
        {
          ...segmentationOn('a', [named, pathOnly, fromArtifact, bare]),
          order: [],
        },
        segmentationOn('a', [mask('second'), mask('stray', 'unknown')]),
        segmentationOn('b', [mask('first'), mask('again')]),
      ],
      segmentationArtifacts: [
        {
          id: 'labels',
          parentImage: 'a',
          name: 'labels.nii.gz',
          path: 'labels.vti',
        },
      ],
    });

    expect(migration.droppedMasks).toEqual([
      ...['Tumor', 'path-only.vti', 'labels.nii.gz label 3', 'bare'].map(
        (name) => ({ name, reason: 'its segmentation does not list it' })
      ),
      { name: 'stray.vti', reason: 'its segment is not in the file' },
      {
        name: 'Tumor',
        reason: 'the image already has a mask for its segment',
      },
    ]);
    expect(entryOf(manifest, 'a').segments[0].labelmap).toEqual(
      labelmap('second')
    );
    expect(entryOf(manifest, 'b').segments[0].labelmap).toEqual(
      labelmap('first')
    );
  });

  it('drops a listed mask that holds no labelmap without reporting it', () => {
    const { manifest, migration } = migrateWith({
      segmentations: [
        segmentationOn('a', [
          { id: 'empty', segmentId: planned.id, representations: {} } as any,
          mask('kept'),
        ]),
      ],
    });

    expect(
      entryOf(manifest, 'a').segments.map(({ labelmap: bound }) => bound)
    ).toEqual([labelmap('kept'), undefined]);
    expect(migration.droppedMasks).toEqual([]);
  });

  it("moves each image's first segmentation display onto its entry", () => {
    const { manifest } = migrateWith({
      segmentations: [
        segmentationOn('a', [mask('first')], {
          name: 'Painted',
          fillOpacity: 0.5,
          outlineThickness: 4,
        }),
        segmentationOn('a', [], {
          name: 'Ignored',
          fillOpacity: 0.9,
          outlineOpacity: 0.1,
          outlineThickness: 9,
        }),
        segmentationOn('b', [mask('second')]),
      ],
    });

    expect(entryOf(manifest, 'a')).not.toHaveProperty('name');
    expect(entryOf(manifest, 'a').display).toEqual({
      fillOpacity: 0.5,
      outlineOpacity: DEFAULT_SEGMENTATION_DISPLAY.outlineOpacity,
      outlineThickness: 4,
    });
    expect(entryOf(manifest, 'b').display).toEqual(
      DEFAULT_SEGMENTATION_DISPLAY
    );
  });
});
