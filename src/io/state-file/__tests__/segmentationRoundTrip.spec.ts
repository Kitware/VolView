import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage,
  inMemoryArtifactIO,
  manifestForImages,
  segmentationSnapshot,
  seedVoxel,
  serializeToStateFiles,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';

import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { deserializeSegmentation } from '@/src/segmentation/io/stateFile';

// Segment identity is independent of voxel values, including maskless segments.

const SOURCE = {
  providerId: 'analysis-provider',
  jobId: 'job-abc',
  outputId: 'outputLabelmap',
};

async function buildScene() {
  await seatSpecImage('img-1', 'CT A');
  await seatSpecImage('img-2', 'CT B');
  const store = useSegmentationStore();
  const { segments } = useSegmentStore();

  // No mask: a segment created by "add" has no voxels until a first edit.
  const planned = segments.mintSegment('img-1', { name: 'Planned' });
  segments.updateSegment(planned, { locked: true, visible: false });
  const tumor = segments.mintSegment('img-1', { name: 'Tumor' });
  seedVoxel(tumor, [0, 0, 0]);
  store.maskOf(tumor)!.source = SOURCE;

  // Same name on another image: still a distinct segment.
  seedVoxel(segments.mintSegment('img-2', { name: 'Tumor' }), [1, 1, 0]);

  segments.selectSegment(tumor);
  await nextTick();
  return { store };
}

const segmentAppearances = (imageId: string) =>
  useSegmentStore()
    .segments.segmentList(imageId)
    .map(({ name, locked, visible }) => ({ name, locked, visible }));

describe('segmentation state-file round trip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('restores segments, order, active segment and artifact provenance', async () => {
    await buildScene();

    const io = inMemoryArtifactIO();
    const before = {
      first: segmentationSnapshot('img-1'),
      second: segmentationSnapshot('img-2'),
      segments: segmentAppearances('img-1'),
    };
    const manifest = manifestForImages(['img-1', 'img-2']);
    const { parsed, stateFiles } = await serializeToStateFiles(manifest, io);
    expect(parsed.imageSegments).toHaveLength(2);
    // Every labelmap a save writes belongs to a mask, so the artifact array
    // that a migration or a backend fills is empty here.
    expect(parsed.segmentationArtifacts).toBeUndefined();
    expect(manifest).not.toHaveProperty('segmentGroups');

    setActivePinia(createPinia());
    await seatSpecImage('new-1', 'CT A');
    await seatSpecImage('new-2', 'CT B');
    const resolveSegment = useSegmentStore().deserialize(parsed, {
      'img-1': 'new-1',
      'img-2': 'new-2',
    });
    await deserializeSegmentation({
      manifest: parsed,
      stateFiles: stateFiles,
      dataIDMap: { 'img-1': 'new-1', 'img-2': 'new-2' },
      resolveSegment,
      io: io,
    });
    await nextTick();

    expect(segmentationSnapshot('new-1')).toEqual(before.first);
    expect(segmentationSnapshot('new-2')).toEqual(before.second);
    expect(segmentAppearances('new-1')).toEqual(before.segments);
  });
});
