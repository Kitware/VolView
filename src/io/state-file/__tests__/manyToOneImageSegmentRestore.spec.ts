import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { buildStateIDToStoreID } from '@/src/io/import/importDataSources';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import {
  makeLabelmap,
  markedVoxels,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useRulerStore } from '@/src/store/tools/rulers';

const definitions = [
  {
    id: 'red',
    name: 'Tumor',
    color: [255, 0, 0, 255],
    fillOpacity: 0.25,
    outlineOpacity: 0.5,
    strokeWidth: 2,
    visible: true,
    locked: true,
  },
  {
    id: 'green',
    name: 'Tumor',
    color: [0, 255, 0, 255],
    fillOpacity: 0.75,
    outlineOpacity: 1,
    strokeWidth: 4,
    visible: false,
    locked: false,
  },
];

const incoming = () =>
  ManifestSchema.parse({
    version: '8.0.0',
    datasets: [
      { id: 'a', dataSourceId: 1 },
      { id: 'b', dataSourceId: 2 },
    ],
    dataSources: [
      { id: 1, type: 'uri', uri: '/a.dcm' },
      { id: 2, type: 'uri', uri: '/b.dcm' },
    ],
    segments: definitions,
    imageSegmentSets: [
      { imageId: 'a', segmentIds: ['red'], selectedSegmentId: 'red' },
      { imageId: 'b', segmentIds: ['green'], selectedSegmentId: 'green' },
    ],
    segmentations: ['a', 'b'].map((parentImage, index) => ({
      id: `seg-${parentImage}`,
      name: parentImage,
      parentImage,
      order: [`mask-${parentImage}`],
      masks: [
        {
          id: `mask-${parentImage}`,
          segmentId: definitions[index].id,
          representations: {
            labelmap: {
              path: `${parentImage}.vti`,
              extent: [0, 1, 0, 1, 0, 0],
            },
          },
        },
      ],
    })),
    tools: {
      rulers: {
        tools: ['a', 'b'].map((imageID, index) => ({
          imageID,
          segmentId: definitions[index].id,
          frameOfReference: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1] },
          slice: 0,
          firstPoint: [0, index, 0],
          secondPoint: [1, index, 0],
        })),
      },
    },
  });

const restoreMerged = async (manifest: Manifest) => {
  await seatImage('merged', { dimensions: [2, 2, 1] });
  const dataIDMap = buildStateIDToStoreID([
    {
      type: 'data',
      dataType: 'image',
      dataID: 'merged',
      dataSource: {
        type: 'collection',
        sources: ['a', 'b'].map((stateID) => ({
          type: 'uri',
          uri: `/${stateID}.dcm`,
          name: `${stateID}.dcm`,
          stateFileLeaf: { stateID },
        })),
      },
    },
  ]);
  const { segmentIdMap, repeated } = useSegmentStore().deserialize(
    manifest,
    dataIDMap
  );
  const labelmaps = new Map([
    [
      'a.vti',
      makeLabelmap({
        dimensions: [2, 2, 1],
        values: new Uint8Array([1, 0, 0, 0]),
      }),
    ],
    [
      'b.vti',
      makeLabelmap({
        dimensions: [2, 2, 1],
        values: new Uint8Array([0, 1, 0, 0]),
      }),
    ],
  ]);
  const { skipped } = await useSegmentationStore().deserialize({
    manifest,
    dataIDMap,
    segmentIdMap,
    stateFiles: [...labelmaps.keys()].map((name) => ({
      archivePath: name,
      file: new File([], name),
    })),
    io: {
      write: async () => '',
      read: async (file) => ({ image: labelmaps.get(file.name)! }),
    },
  });
  useRulerStore().deserialize(manifest, dataIDMap, segmentIdMap);
  return { dataIDMap, segmentIdMap, skipped, repeated };
};

const expectBothContents = () => {
  const masks = useSegmentationStore().imageMasks('merged');
  expect(masks).toHaveLength(2);
  expect(masks.map(({ id }) => markedVoxels(id))).toEqual([
    [[0, 0, 0, 1]],
    [[1, 0, 0, 1]],
  ]);
  expect(masks[0].segmentId).not.toBe(masks[1].segmentId);
  expect(
    masks.map(({ segmentId }) =>
      useSegmentStore().segments.appearanceOf(segmentId)
    )
  ).toMatchObject(
    definitions.map(
      ({
        color,
        fillOpacity,
        outlineOpacity,
        strokeWidth,
        visible,
        locked,
      }) => ({
        color,
        fillOpacity,
        outlineOpacity,
        strokeWidth,
        visible,
        locked,
      })
    )
  );
  const shapes = useRulerStore().serializeTools().tools;
  expect(
    shapes.map(({ segmentId, firstPoint, secondPoint, imageID }) => ({
      segmentId,
      firstPoint,
      secondPoint,
      imageID,
    }))
  ).toEqual(
    masks.map(({ segmentId }, index) => ({
      segmentId,
      firstPoint: [0, index, 0],
      secondPoint: [1, index, 0],
      imageID: 'merged',
    }))
  );
};

describe('saved image sets resolving to one runtime image', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('preserves distinct same-name definitions, appearance, masks and shapes in an incoming 8.0.0 manifest', async () => {
    const manifest = incoming();
    const { dataIDMap, segmentIdMap, skipped, repeated } =
      await restoreMerged(manifest);
    expect(dataIDMap).toEqual({ a: 'merged', b: 'merged' });
    expect(segmentIdMap.red).not.toBe(segmentIdMap.green);
    expect(
      useSegmentStore()
        .segments.segmentList('merged')
        .map(({ name }) => name)
    ).toEqual(['Tumor', 'Tumor (2)']);
    expect(useSegmentStore().segments.selectedSegmentId('merged')).toBe(
      segmentIdMap.red
    );
    expect(skipped).toEqual([]);
    expect(repeated).toEqual([]);
    expectBothContents();
  });

  it('binds legacy masks and shapes from different slices to their shared definition', async () => {
    const old = { ...incoming(), version: '7.0.0', selectedSegment: 'red' };
    old.segments = old.segments!.slice(0, 1);
    old.segmentations = old.segmentations!.slice(0, 1);
    old.tools!.rulers!.tools[1].segmentId = 'red';
    const manifest = ManifestSchema.parse(migrateManifest(JSON.stringify(old)));
    const { skipped, repeated } = await restoreMerged(manifest);
    const registry = useSegmentStore().segments;
    expect(registry.segmentList('merged').map(({ name }) => name)).toEqual([
      'Tumor',
    ]);
    const [mask] = useSegmentationStore().imageMasks('merged');
    expect(
      useRulerStore()
        .serializeTools()
        .tools.map(({ segmentId }) => segmentId)
    ).toEqual([mask.segmentId, mask.segmentId]);
    expect(skipped).toEqual([]);
    expect(repeated).toEqual([]);
  });

  it('preserves distinct legacy global definitions when their images resolve together', async () => {
    const old = { ...incoming(), version: '7.0.0', selectedSegment: 'red' };
    const manifest = ManifestSchema.parse(migrateManifest(JSON.stringify(old)));
    const { skipped, repeated } = await restoreMerged(manifest);
    expect(skipped).toEqual([]);
    expect(repeated).toEqual([]);
    expect(
      useSegmentStore()
        .segments.segmentList('merged')
        .map(({ name }) => name)
    ).toEqual(['Tumor', 'Tumor (2)']);
    expectBothContents();
  });

  it('reports a repeated membership and keeps its first identity and mask', async () => {
    const manifest = incoming();
    manifest.imageSegmentSets![1].segmentIds = ['red'];
    manifest.imageSegmentSets![1].selectedSegmentId = 'red';
    manifest.segmentations![1].masks[0].segmentId = 'red';
    manifest.tools!.rulers!.tools[1].segmentId = 'red';
    const { segmentIdMap, repeated, skipped } = await restoreMerged(manifest);
    expect(repeated.map(({ name }) => name)).toEqual(['Tumor']);
    expect(segmentIdMap.green).toBeUndefined();
    expect(useSegmentStore().segments.segmentList('merged')).toHaveLength(1);
    expect(
      useSegmentStore().segments.getSegment(segmentIdMap.red)?.color
    ).toEqual(definitions[0].color);
    expect(skipped.map(({ reason }) => reason)).toEqual([
      'the image already has a mask for its segment',
    ]);
    const masks = useSegmentationStore().imageMasks('merged');
    expect(masks.map(({ id }) => markedVoxels(id))).toEqual([[[0, 0, 0, 1]]]);
    expect(
      useRulerStore()
        .serializeTools()
        .tools.map(({ segmentId }) => segmentId)
    ).toEqual([segmentIdMap.red, segmentIdMap.red]);
  });
});
