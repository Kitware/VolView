import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, markRaw, nextTick } from 'vue';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getEnFaceUnavailableReason } from '@/src/enface/availability';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { untilLoaded } from '@/src/composables/untilLoaded';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { Tags } from '@/src/core/dicomTags';

describe('OCT view availability', () => {
  let emptyImage: DicomChunkImage | undefined;
  const decodeReleases: (() => void)[] = [];

  beforeEach(() => setActivePinia(createPinia()));
  afterEach(async () => {
    await cleanupCachedImages(decodeReleases);
    emptyImage?.dispose();
    emptyImage = undefined;
  });

  it('keeps the view disabled while a cached DICOM image has no metadata chunks', () => {
    emptyImage = new DicomChunkImage();
    useImageCacheStore().imageById.pending = markRaw(emptyImage);
    expect(getEnFaceUnavailableReason('pending')).toMatch(/volume/);
  });

  it('gives a visible disabled reason for missing or deleted image references', () => {
    expect(getEnFaceUnavailableReason(null)).not.toBeNull();
    expect(getEnFaceUnavailableReason('deleted')).toMatch(/volume/);
  });

  it('reacts to metadata allocation and complete pixel loading after initially empty raw chunks', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    decodeReleases.push(fixture.releaseDecode);
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'pending' });
    const reason = computed(() => getEnFaceUnavailableReason('pending'));
    expect(reason.value).not.toBeNull();
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    await nextTick();
    expect(reason.value).toMatch(/complete volume/);
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded('pending');
    await nextTick();
    expect(reason.value).toBeNull();
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
      expect(getEnFaceUnavailableReason(id)).toMatch(reason);
    }
  );

  it('uses the loaded geometry for an explicitly chosen signed generic grid', () => {
    const data = vtkImageData.newInstance();
    data.setDimensions([2, 2, 2]);
    data.setSpacing([-0.03, 0.01, 0.2]);
    data
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(8) }));
    const id = useImageCacheStore().addVTKImageData(data, 'signed.vti');
    expect(getEnFaceUnavailableReason(id)).toBeNull();
    expect(data.getSpacing()).toEqual([-0.03, 0.01, 0.2]);
  });

  it.each(['CT', 'MR', 'PT'] as const)(
    'allows a complete grayscale DICOM volume with modality %s',
    async (modality) => {
      const fixture = createOCTFixture();
      const id = useImageCacheStore().addProgressiveImage(fixture.image);
      await fixture.chunk.loadMeta();
      const sop = {
        CT: '1.2.840.10008.5.1.4.1.1.2',
        MR: '1.2.840.10008.5.1.4.1.1.4',
        PT: '1.2.840.10008.5.1.4.1.1.128',
      }[modality];
      fixture.chunk.metadata!.forEach((pair) => {
        if (pair[0] === Tags.Modality) pair[1] = modality;
        if (pair[0] === Tags.SOPClassUID) pair[1] = sop;
      });
      await fixture.image.addChunks([fixture.chunk]);
      fixture.image.startLoad();
      await untilLoaded(id);
      expect(getEnFaceUnavailableReason(id)).toBeNull();
    }
  );

  it.each(['radial', 'nonvolumetric'])(
    'does not bypass declared OCT geometry guards: %s',
    async (kind) => {
      const fixture = createOCTFixture({
        scanPattern: kind === 'radial' ? '128281' : undefined,
      });
      useImageCacheStore().addProgressiveImage(fixture.image, {
        id: 'guarded',
      });
      await fixture.chunk.loadMeta();
      if (kind === 'nonvolumetric')
        fixture.chunk.metadata!.push([
          Tags.OphthalmicVolumetricPropertiesFlag,
          'NO',
        ]);
      await fixture.image.addChunks([fixture.chunk]);
      fixture.image.startLoad();
      await untilLoaded('guarded');
      expect(getEnFaceUnavailableReason('guarded')).toMatch(
        kind === 'radial' ? /reconstruction/ : /unsuitable/
      );
    }
  );
});
