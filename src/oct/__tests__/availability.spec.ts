import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, markRaw, nextTick } from 'vue';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getOCTAvailability } from '@/src/oct/availability';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { untilLoaded } from '@/src/composables/untilLoaded';

describe('OCT view availability', () => {
  let emptyImage: DicomChunkImage | undefined;
  let releaseDecode: (() => void) | undefined;

  beforeEach(() => setActivePinia(createPinia()));
  afterEach(async () => {
    releaseDecode?.();
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach((id) => cache.removeImage(id));
    emptyImage?.dispose();
    emptyImage = undefined;
    releaseDecode = undefined;
    await nextTick();
  });

  it('keeps the view disabled while a cached DICOM image has no metadata chunks', () => {
    emptyImage = new DicomChunkImage();
    useImageCacheStore().imageById.pending = markRaw(emptyImage);
    const availability = getOCTAvailability('pending');
    expect(availability.available).toBe(false);
    expect(availability.isOCT).toBe(false);
    expect(availability.calibratedAxes).toEqual([false, false, false]);
    expect(availability.reason).toMatch(/OCT/);
  });

  it('gives a visible disabled reason for missing or deleted image references', () => {
    expect(getOCTAvailability(null).available).toBe(false);
    expect(getOCTAvailability('deleted').reason).toMatch(/OCT/);
  });

  it('reacts to metadata allocation and complete pixel loading after initially empty raw chunks', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    releaseDecode = fixture.releaseDecode;
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'pending' });
    const availability = computed(() => getOCTAvailability('pending'));
    expect(availability.value.isOCT).toBe(false);
    expect(availability.value.available).toBe(false);
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    await nextTick();
    expect(availability.value.isOCT).toBe(true);
    expect(availability.value.reason).toMatch(/complete OCT volume/);
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded('pending');
    await nextTick();
    expect(availability.value.available).toBe(true);
    expect(availability.value.reason).toBeNull();
    expect(availability.value.calibratedAxes).toEqual([true, true, true]);
    expect(fixture.image.getVtkImageData().getDimensions()).toEqual([
      128, 222, 32,
    ]);
    expect(
      fixture.image.getVtkImageData().getPointData().getScalars().getData()
    ).toHaveLength(128 * 222 * 32);
  });
});
