import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, markRaw, nextTick } from 'vue';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getOCTAvailability } from '@/src/oct/availability';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { untilLoaded } from '@/src/composables/untilLoaded';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { Tags } from '@/src/core/dicomTags';

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
  it.each([
    { dimensions: [1, 2, 2], components: 1, reason: /three-dimensional/ },
    { dimensions: [2, 2, 2], components: 3, reason: /grayscale/ },
  ])(
    'keeps incompatible generic grids disabled: %j',
    ({ dimensions, components, reason }) => {
      const data = vtkImageData.newInstance();
      data.setDimensions(dimensions);
      data.getPointData().setScalars(
        vtkDataArray.newInstance({
          numberOfComponents: components,
          values: new Uint8Array(
            dimensions.reduce((count, n) => count * n, components)
          ),
        })
      );
      const id = useImageCacheStore().addVTKImageData(data, 'generic.nrrd');
      expect(getOCTAvailability(id)).toMatchObject({
        available: false,
        isOCT: false,
      });
      expect(getOCTAvailability(id).reason).toMatch(reason);
    }
  );

  it('allows an explicitly chosen signed generic grid without claiming unknown units', () => {
    const data = vtkImageData.newInstance();
    data.setDimensions([2, 2, 2]);
    data.setSpacing([-0.03, 0.01, 0.2]);
    data
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(8) }));
    const id = useImageCacheStore().addVTKImageData(data, 'signed.vti');
    expect(getOCTAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
      calibratedAxes: [false, false, false],
    });
    expect(data.getSpacing()).toEqual([-0.03, 0.01, 0.2]);
  });

  it.each(['unknown', 'radial', 'nonvolumetric'])(
    'does not bypass declared DICOM identity or geometry guards: %s',
    async (kind) => {
      const fixture = createOCTFixture({
        scanPattern: kind === 'radial' ? '128281' : undefined,
      });
      useImageCacheStore().addProgressiveImage(fixture.image, {
        id: 'guarded',
      });
      await fixture.chunk.loadMeta();
      if (kind === 'unknown') {
        fixture.chunk.metadata!.forEach((pair) => {
          if (pair[0] === Tags.Modality) pair[1] = 'CT';
          if (pair[0] === Tags.SOPClassUID)
            pair[1] = '1.2.840.10008.5.1.4.1.1.2';
        });
      }
      if (kind === 'nonvolumetric')
        fixture.chunk.metadata!.push([
          Tags.OphthalmicVolumetricPropertiesFlag,
          'NO',
        ]);
      await fixture.image.addChunks([fixture.chunk]);
      fixture.image.startLoad();
      await untilLoaded('guarded');
      const availability = getOCTAvailability('guarded');
      expect(availability.available).toBe(false);
      expect(availability.isOCT).toBe(kind !== 'unknown');
      expect(availability.reason).toMatch(
        kind === 'radial'
          ? /reconstruction/
          : kind === 'nonvolumetric'
            ? /unsuitable/
            : /ophthalmic/
      );
    }
  );
});
