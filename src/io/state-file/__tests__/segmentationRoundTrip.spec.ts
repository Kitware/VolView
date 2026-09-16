import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage,
  inMemoryArtifactIO,
  mintSegment,
  segmentOfMask,
  manifestForImages,
  segmentationSnapshot,
  serializeToStateFiles,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';

import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';

// Segment identity is independent of voxel values, including unbound masks.

const SOURCE = {
  providerId: 'analysis-provider',
  jobId: 'job-abc',
  outputId: 'outputLabelmap',
};

async function buildScene() {
  await seatSpecImage('img-1', 'CT A');
  await seatSpecImage('img-2', 'CT B');
  const store = useSegmentationStore();

  const first = store.ensureSegmentationForImage('img-1');
  // No binding: a segment created by "add" has no voxels until a first edit.
  const planned = store.createMask(first.id, mintSegment({ name: 'Planned' }));
  useSegmentStore().segments.updateSegment(segmentOfMask(planned.id), {
    locked: true,
    visible: false,
  });
  const tumor = store.createMask(first.id, mintSegment({ name: 'Tumor' }));
  store.ensureLabelmapBinding(tumor.id).source = SOURCE;

  // Same name on another image: still a distinct segment.
  const second = store.ensureSegmentationForImage('img-2');
  const otherTumor = store.createMask(
    second.id,
    mintSegment({ name: 'Tumor' })
  );
  store.ensureLabelmapBinding(otherTumor.id);

  useSegmentStore().segments.selectSegment(store.getMask(tumor.id).segmentId);
  await nextTick();
  return { store };
}

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
    };
    const manifest = manifestForImages(['img-1', 'img-2']);
    const { parsed, stateFiles } = await serializeToStateFiles(manifest, io);
    expect(parsed.segmentations).toHaveLength(2);
    // Every labelmap a save writes belongs to a mask, so the artifact array
    // that a migration or a backend fills is empty here.
    expect(parsed.segmentationArtifacts).toBeUndefined();
    expect(manifest).not.toHaveProperty('segmentGroups');

    setActivePinia(createPinia());
    await seatSpecImage('new-1', 'CT A');
    await seatSpecImage('new-2', 'CT B');
    const { segmentIdMap } = useSegmentStore().deserialize(parsed);
    await useSegmentationStore().deserialize({
      manifest: parsed,
      stateFiles: stateFiles,
      dataIDMap: { 'img-1': 'new-1', 'img-2': 'new-2' },
      segmentIdMap: segmentIdMap,
      io: io,
    });
    await nextTick();

    expect(segmentationSnapshot('new-1')).toEqual(before.first);
    expect(segmentationSnapshot('new-2')).toEqual({
      ...before.second,
      segments: [{ ...before.second.segments[0], name: 'Tumor (2)' }],
    });
  });
});
