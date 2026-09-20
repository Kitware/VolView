import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';

import {
  addMask,
  inMemoryArtifactIO,
  manifestForImages,
  seatSpecImage as seatImage,
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
    await seatImage('img-1', 'CT A');
    store().ensureLabelmapBinding(addMask('img-1', 'Tumor'));
    const cancelPreview = vi.fn();
    useSegmentationEditsStore().hold(cancelPreview);

    const manifest = manifestForImages(['img-1']);
    await store().serialize(
      { zip: new JSZip(), manifest },
      inMemoryArtifactIO()
    );

    expect(cancelPreview).toHaveBeenCalledTimes(1);
    expect(manifest.segmentations![0].masks).toHaveLength(1);
  });
});
