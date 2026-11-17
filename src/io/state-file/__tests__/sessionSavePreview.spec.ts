import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';

import { serializeSegmentation } from '@/src/segmentation/io/stateFile';
import {
  addSegment,
  inMemoryArtifactIO,
  manifestForImages,
  savedLabelmaps,
  seatSpecImage,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';

// ---------------------------------------------------------------------------
// A process preview occupies live mask storage until it is confirmed. A session
// save reads committed content, so it resolves the preview first: what the
// screen is showing must not be what the file gets. Export and job staging are
// pinned where they live; this is the save.
// ---------------------------------------------------------------------------

describe('saving a session with an unconfirmed preview', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('cancels the preview and saves what the mask committed', async () => {
    await seatSpecImage('img-1', 'CT A');
    const segmentId = addSegment('img-1', 'Tumor');
    seedVoxel(segmentId, [0, 0, 0]);
    seedVoxel(segmentId, [1, 0, 0]);
    const voxels = store().maskVoxels(segmentId);
    const committed = new Uint8Array(voxels.scalars());
    voxels.scalars().fill(0);
    const cancelPreview = vi.fn(() => voxels.apply(committed));
    useSegmentationEditsStore().hold(cancelPreview);

    const manifest = manifestForImages(['img-1']);
    const io = inMemoryArtifactIO();
    await serializeSegmentation({ zip: new JSZip(), manifest }, io);

    expect(io.snapshots[0].values).toEqual([1, 1]);
    expect(cancelPreview).toHaveBeenCalledTimes(1);
    expect(savedLabelmaps(manifest)).toHaveLength(1);
  });
});
