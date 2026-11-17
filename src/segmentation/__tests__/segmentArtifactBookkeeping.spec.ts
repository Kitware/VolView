import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';

import type { Manifest } from '@/src/io/state-file/schema';
import {
  addSegment,
  inMemoryArtifactIO,
  savedLabelmaps,
  seatImage,
  seedVoxel,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { serializeSegmentation } from '@/src/segmentation/io/stateFile';
import { useSegmentStore } from '@/src/segmentation/segments';

async function buildScene() {
  await seatImage('img-1', { name: 'CT A' });
  await seatImage('img-2', { name: 'CT B' });

  const tumor = addSegment('img-1', 'Tumor');
  seedVoxel(tumor, [1, 1, 1]);
  const node = addSegment('img-1', 'Node');
  seedVoxel(node, [2, 2, 2]);
  // Identity with no storage: it owns no mask and names no archive entry.
  const planned = addSegment('img-1', 'Planned');

  const other = addSegment('img-2', 'Tumor');
  seedVoxel(other, [0, 0, 0]);

  return { tumor, node, planned, other };
}

describe('mask lookups and archive entries', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("finds a segment's display from the segment id", async () => {
    // The renderer is handed a segment id and nothing else, so the display
    // has to be reachable from that id alone.
    const { tumor } = await buildScene();
    const segments = useSegmentStore().segments;
    segments.updateDisplay('img-1', {
      outlineOpacity: 0.25,
      outlineThickness: 5,
    });

    expect(segments.displayOf(segments.ownerImageId(tumor))).toMatchObject({
      outlineOpacity: 0.25,
      outlineThickness: 5,
    });
  });

  it('serializes one archive entry per mask, at a path of its own', async () => {
    await buildScene();
    const manifest = {} as Manifest;

    await serializeSegmentation(
      { zip: new JSZip(), manifest },
      inMemoryArtifactIO()
    );

    const bound = savedLabelmaps(manifest).map(({ imageId, labelmap }) => ({
      binding: labelmap,
      parentImage: imageId,
    }));
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
