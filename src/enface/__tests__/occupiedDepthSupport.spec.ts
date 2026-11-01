import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw } from 'vue';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getOccupiedDepthSupport } from '@/src/enface/occupiedDepthSupport';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { Tags } from '@/src/core/dicomTags';
import { Chunk } from '@/src/core/streaming/chunk';

describe('occupied-depth support for loaded volumes', () => {
  const pendingReads: (() => void)[] = [];
  let emptyImage: DicomChunkImage | undefined;

  beforeEach(() => setActivePinia(createPinia()));
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupCachedImages(pendingReads);
    emptyImage?.dispose();
    emptyImage = undefined;
  });

  it('reports no measurement blocker while a cached DICOM image has no metadata chunks', () => {
    emptyImage = new DicomChunkImage();
    useImageCacheStore().imageById.pending = markRaw(emptyImage);
    expect(getOccupiedDepthSupport('pending')).toEqual({
      reason: null,
      calibratedAxes: undefined,
    });
  });

  it('defers metadata inspection until complete loading and reuses it for an unchanged grid', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    pendingReads.push(fixture.releaseDecode);
    const id = useImageCacheStore().addProgressiveImage(fixture.image);
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    const chunks = vi.spyOn(fixture.image, 'getChunks');
    expect(getOccupiedDepthSupport(id).calibratedAxes).toBeUndefined();
    expect(chunks).not.toHaveBeenCalled();
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded(id);
    chunks.mockClear();
    const initial = getOccupiedDepthSupport(id);
    const repeated = getOccupiedDepthSupport(id);
    expect(initial.reason).toBeNull();
    expect(repeated).toEqual(initial);
    expect(chunks).toHaveBeenCalledTimes(1);
    fixture.image.getVtkImageData().setSpacing([1, 1, 1]);
    expect(getOccupiedDepthSupport(id).calibratedAxes).toEqual([
      false,
      false,
      false,
    ]);
    expect(chunks).toHaveBeenCalledTimes(2);
  });

  it.each([
    { regionCount: 1, calibrated: true },
    { regionCount: 2, calibrated: false },
  ])(
    'calibrates ultrasound with $regionCount regions without PixelSpacing: $calibrated',
    async ({ regionCount, calibrated }) => {
      const fixture = createOCTFixture();
      await fixture.chunk.loadMeta();
      const metadata = fixture.chunk.metadata!.filter(
        ([tag]) => ![Tags.Modality, Tags.PixelSpacing].includes(tag)
      );
      metadata.push([Tags.Modality, 'US']);
      const blob = fixture.chunk.metaBlob!;
      const chunk = new Chunk({
        metaLoader: {
          meta: metadata,
          metaBlob: blob,
          ultrasoundRegions: {
            regionCount,
            region: {
              physicalUnitsXDirection: 3,
              physicalUnitsYDirection: 3,
              physicalDeltaX: 0.002,
              physicalDeltaY: 0.00104,
            },
          },
          load: () => {},
          stop: () => {},
        },
        dataLoader: { data: blob, load: () => {}, stop: () => {} },
      });
      fixture.chunk.dispose();
      const id = useImageCacheStore().addProgressiveImage(fixture.image);
      await fixture.image.addChunks([chunk]);
      fixture.image.startLoad();
      await untilLoaded(id);
      expect(fixture.image.getVtkImageData().getSpacing()[1]).toBeCloseTo(
        0.0104,
        7
      );
      expect(getOccupiedDepthSupport(id).calibratedAxes).toEqual([
        calibrated,
        calibrated,
        true,
      ]);
    }
  );
});
