import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, markRaw, nextTick } from 'vue';
import DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getEnFaceUnavailableReason } from '@/src/enface/availability';
import { createOCTFixture, volumeOf } from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { untilLoaded } from '@/src/composables/untilLoaded';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { Tags } from '@/packages/dicom/core';
import { setDicomTag } from './dicomMetadataFixture';

describe('OCT view availability', () => {
  let emptyImage: DicomVolumeImage | undefined;
  const decodeReleases: (() => void)[] = [];

  beforeEach(() => setActivePinia(createPinia()));
  afterEach(async () => {
    await cleanupCachedImages(decodeReleases);
    emptyImage?.dispose();
    emptyImage = undefined;
  });

  it('keeps the view disabled while a cached DICOM image has no volume yet', async () => {
    emptyImage = (await createOCTFixture()).image;
    useImageCacheStore().imageById.pending = markRaw(emptyImage);
    expect(getEnFaceUnavailableReason('pending')).toMatch(/volume/);
  });

  it('gives a visible disabled reason for missing or deleted image references', () => {
    expect(getEnFaceUnavailableReason(null)).not.toBeNull();
    expect(getEnFaceUnavailableReason('deleted')).toMatch(/volume/);
  });

  it('reacts to allocation and complete pixel loading after starting empty', async () => {
    const fixture = await createOCTFixture({ deferDecode: true });
    decodeReleases.push(fixture.releaseDecode);
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'pending' });
    const reason = computed(() => getEnFaceUnavailableReason('pending'));
    expect(reason.value).not.toBeNull();
    fixture.image.setVolume(volumeOf([fixture.instance]));
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
      const fixture = await createOCTFixture();
      const sop = {
        CT: '1.2.840.10008.5.1.4.1.1.2',
        MR: '1.2.840.10008.5.1.4.1.1.4',
        PT: '1.2.840.10008.5.1.4.1.1.128',
      }[modality];
      setDicomTag(fixture.instance.dataset, Tags.Modality, modality);
      setDicomTag(fixture.instance.dataset, Tags.SOPClassUID, sop);
      fixture.image.setVolume(volumeOf([fixture.instance]));
      const id = useImageCacheStore().addProgressiveImage(fixture.image);
      await untilLoaded(id);
      expect(getEnFaceUnavailableReason(id)).toBeNull();
    }
  );

  it.each(['radial', 'nonvolumetric'])(
    'does not bypass declared OCT geometry guards: %s',
    async (kind) => {
      const fixture = await createOCTFixture({
        scanPattern: kind === 'radial' ? '128281' : undefined,
      });
      if (kind === 'nonvolumetric')
        setDicomTag(
          fixture.instance.dataset,
          Tags.OphthalmicVolumetricPropertiesFlag,
          'NO'
        );
      fixture.image.setVolume(volumeOf([fixture.instance]));
      useImageCacheStore().addProgressiveImage(fixture.image, {
        id: 'guarded',
      });
      await untilLoaded('guarded');
      expect(getEnFaceUnavailableReason('guarded')).toMatch(
        kind === 'radial' ? /reconstruction/ : /unsuitable/
      );
    }
  );
});
