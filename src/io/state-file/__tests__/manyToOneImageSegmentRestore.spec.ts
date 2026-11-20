import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { buildStateIDToStoreID } from '@/src/io/import/importDataSources';
import { readSessionSetup } from '@/src/io/import/__tests__/restoreProcessorFixtures';
import type { Manifest } from '@/src/io/state-file/schema';
import {
  makeLabelmap,
  manifestForImages,
  markedVoxels,
  segmentNames,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { deserializeSegmentation } from '@/src/segmentation/io/stateFile';
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

const maskOn = (parentImage: string, index: number) => ({
  segmentId: definitions[index].id,
  representations: {
    labelmap: {
      path: `${parentImage}.vti`,
      extent: [0, 1, 0, 1, 0, 0],
    },
  },
});

// A 7.0.0 scene whose catalog every image shared.
const legacy = () => ({
  ...manifestForImages(['a', 'b']),
  version: '7.0.0',
  segments: definitions,
  selectedSegment: 'red',
  segmentations: ['a', 'b'].map((parentImage, index) => ({
    id: `seg-${parentImage}`,
    name: parentImage,
    parentImage,
    order: [`mask-${parentImage}`],
    masks: [{ id: `mask-${parentImage}`, ...maskOn(parentImage, index) }],
  })),
  tools: {
    rulers: {
      tools: ['a', 'b'].map((imageID, index) => ({
        imageID,
        segmentId: definitions[index].id,
        frameOfReference: {
          planeOrigin: [0, 0, 0],
          planeNormal: [0, 0, 1],
        },
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
  const resolveSegment = useSegmentStore().deserialize(manifest, dataIDMap);
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
  const { skipped } = await deserializeSegmentation({
    manifest,
    dataIDMap,
    resolveSegment,
    stateFiles: [...labelmaps.keys()].map((name) => ({
      archivePath: name,
      file: new File([], name),
    })),
    io: {
      write: async () => '',
      read: async (file) => ({ image: labelmaps.get(file.name)! }),
    },
  });
  useRulerStore().deserialize(manifest, dataIDMap, resolveSegment);
  return skipped;
};

const expectBothContents = () => {
  const masks = useSegmentationStore().imageMasks('merged');
  expect(masks).toHaveLength(2);
  expect(masks.map(({ segmentId }) => markedVoxels(segmentId))).toEqual([
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

  it('binds masks and shapes that share a saved id to one segment', async () => {
    const old = legacy();
    old.segments = old.segments.slice(0, 1);
    old.segmentations = old.segmentations.slice(0, 1);
    old.tools.rulers.tools[1].segmentId = 'red';
    const skipped = await restoreMerged((await readSessionSetup(old)).manifest);
    expect(segmentNames('merged')).toEqual(['Tumor']);
    const [mask] = useSegmentationStore().imageMasks('merged');
    expect(
      useRulerStore()
        .serializeTools()
        .tools.map(({ segmentId }) => segmentId)
    ).toEqual([mask.segmentId, mask.segmentId]);
    expect(skipped).toEqual([]);
  });

  it('keeps distinct same-named definitions apart', async () => {
    const skipped = await restoreMerged(
      (await readSessionSetup(legacy())).manifest
    );
    expect(skipped).toEqual([]);
    expect(segmentNames('merged')).toEqual(['Tumor', 'Tumor (2)']);
    expectBothContents();
  });
});
