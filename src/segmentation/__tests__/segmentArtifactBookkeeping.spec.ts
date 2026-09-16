import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';

import type { Manifest } from '@/src/io/state-file/schema';
import {
  addMask,
  boundMasks,
  inMemoryArtifactIO,
  labelmapValues,
  makeLabelmap,
  seatImage,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

async function buildScene() {
  await seatImage('img-1', { name: 'CT A' });
  await seatImage('img-2', { name: 'CT B' });

  const tumor = addMask('img-1', 'Tumor');
  seedVoxel(tumor, [1, 1, 1]);
  const node = addMask('img-1', 'Node');
  seedVoxel(node, [2, 2, 2]);
  // Identity with no storage: it owns no mask and names no archive entry.
  const planned = addMask('img-1', 'Planned');

  const other = addMask('img-2', 'Tumor');
  seedVoxel(other, [0, 0, 0]);

  return { tumor, node, planned, other };
}

const importedLabelmap = () =>
  makeLabelmap({
    values: labelmapValues([4, 4, 4], [{ value: 1, at: [0, 0, 0] }]),
  });

const names = () =>
  boundMasks().map((mask) => mask.representations.labelmap!.name);

const split = (name?: string) =>
  store().splitLabelmapIntoMasks(
    'img-1',
    importedLabelmap(),
    [{ value: 1, name: 'Liver', color: [255, 0, 0, 255], visible: true }],
    { name: name }
  );

// A restored artifact's name reaches the saved manifest and the zip entry path,
// so generating one where the manifest carried one renames the file on every
// round trip.
describe('artifact names carried in from a manifest', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { name: 'CT A' });
  });

  it('keeps the name the caller carried', () => {
    split('Liver: left/right*?');

    expect(names()).toEqual(['Liver: left/right*?']);
  });

  it('generates one when the caller carries none', () => {
    split();

    expect(names()).toEqual(['Segment Group 1 for CT A']);
  });
});

describe('mask lookups and archive entries', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("finds a mask's segmentation from the mask id", async () => {
    // The renderer is handed a mask id and nothing else, so the segment model
    // has to be reachable from that id alone.
    const { tumor } = await buildScene();
    const segmentation = store().getSegmentationForImage('img-1')!;
    segmentation.outlineOpacity = 0.25;
    segmentation.outlineThickness = 5;

    expect(store().segmentationOfMask(tumor)).toMatchObject({
      outlineOpacity: 0.25,
      outlineThickness: 5,
    });
  });

  it('serializes one archive entry per mask, at a path of its own', async () => {
    await buildScene();
    const manifest = {} as Manifest;

    await store().serialize(
      { zip: new JSZip(), manifest },
      inMemoryArtifactIO()
    );

    const bound = manifest.segmentations!.flatMap((segmentation) =>
      segmentation.masks.flatMap((mask) => {
        const binding = mask.representations.labelmap;
        return binding
          ? [{ binding, parentImage: segmentation.parentImage }]
          : [];
      })
    );
    // Three segments hold storage; the unmaterialized one names no entry.
    expect(bound).toHaveLength(3);
    expect(new Set(bound.map((entry) => entry.binding.path))).toHaveProperty(
      'size',
      3
    );
    expect(bound.map((entry) => entry.parentImage).sort()).toEqual([
      'img-1',
      'img-1',
      'img-2',
    ]);
    // A save's labelmaps all belong to a mask, so it writes no artifact.
    expect(manifest.segmentationArtifacts).toBeUndefined();
  });
});
