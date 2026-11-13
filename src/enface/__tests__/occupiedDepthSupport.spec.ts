import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw } from 'vue';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getOccupiedDepthSupport } from '@/src/enface/occupiedDepthSupport';
import { createOCTFixture, volumeOf } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { Tags } from '@/packages/dicom/core';
import { removeDicomTag, setDicomTag } from './dicomMetadataFixture';

describe('occupied-depth support for loaded volumes', () => {
  const pendingReads: (() => void)[] = [];
  let emptyImage: { dispose: () => void } | undefined;

  beforeEach(() => setActivePinia(createPinia()));
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupCachedImages(pendingReads);
    emptyImage?.dispose();
    emptyImage = undefined;
  });

  it('reports no measurement blocker while a cached DICOM image has no volume yet', async () => {
    const { image } = await createOCTFixture();
    emptyImage = image;
    useImageCacheStore().imageById.pending = markRaw(image);
    expect(getOccupiedDepthSupport('pending')).toEqual({
      reason: null,
      calibratedAxes: undefined,
    });
  });

  it('defers metadata inspection until complete loading and reuses it for an unchanged grid', async () => {
    const fixture = await createOCTFixture({ deferDecode: true });
    pendingReads.push(fixture.releaseDecode);
    fixture.image.setVolume(volumeOf([fixture.instance]));
    const id = useImageCacheStore().addProgressiveImage(fixture.image);
    const getInstances = vi.spyOn(fixture.image, 'getInstances');
    expect(getOccupiedDepthSupport(id).calibratedAxes).toBeUndefined();
    expect(getInstances).not.toHaveBeenCalled();
    fixture.releaseDecode();
    await untilLoaded(id);
    getInstances.mockClear();
    const initial = getOccupiedDepthSupport(id);
    const repeated = getOccupiedDepthSupport(id);
    expect(initial.reason).toBeNull();
    expect(repeated).toEqual(initial);
    expect(getInstances).toHaveBeenCalledTimes(1);
    fixture.image.getVtkImageData().setSpacing([1, 1, 1]);
    expect(getOccupiedDepthSupport(id).calibratedAxes).toEqual([
      false,
      false,
      false,
    ]);
    expect(getInstances).toHaveBeenCalledTimes(2);
  });

  it.each([
    { regionCount: 1, calibrated: true },
    { regionCount: 2, calibrated: false },
  ])(
    'calibrates ultrasound with $regionCount regions without PixelSpacing: $calibrated',
    async ({ regionCount, calibrated }) => {
      const fixture = await createOCTFixture();
      const { dataset } = fixture.instance;
      removeDicomTag(dataset, Tags.PixelSpacing);
      setDicomTag(dataset, Tags.Modality, 'US');
      const ultrasound = Object.freeze({
        ...fixture.instance,
        ultrasoundRegions: {
          regionCount,
          region: {
            physicalUnitsXDirection: 3,
            physicalUnitsYDirection: 3,
            physicalDeltaX: 0.002,
            physicalDeltaY: 0.00104,
          },
        },
      });
      fixture.image.setVolume(volumeOf([ultrasound]));
      const id = useImageCacheStore().addProgressiveImage(fixture.image);
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
