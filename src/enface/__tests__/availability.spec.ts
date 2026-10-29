import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, markRaw, nextTick } from 'vue';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getEnFaceAvailability } from '@/src/enface/availability';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { untilLoaded } from '@/src/composables/untilLoaded';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { Tags } from '@/src/core/dicomTags';
import { Chunk } from '@/src/core/streaming/chunk';

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
    vi.restoreAllMocks();
    await nextTick();
  });

  it('keeps the view disabled while a cached DICOM image has no metadata chunks', () => {
    emptyImage = new DicomChunkImage();
    useImageCacheStore().imageById.pending = markRaw(emptyImage);
    const availability = getEnFaceAvailability('pending');
    expect(availability.available).toBe(false);
    expect(availability.measurementGeometryReason).toBeNull();
    expect(availability.reason).toMatch(/volume/);
  });

  it('gives a visible disabled reason for missing or deleted image references', () => {
    expect(getEnFaceAvailability(null).available).toBe(false);
    expect(getEnFaceAvailability('deleted').reason).toMatch(/volume/);
  });

  it('reacts to metadata allocation and complete pixel loading after initially empty raw chunks', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    releaseDecode = fixture.releaseDecode;
    useImageCacheStore().addProgressiveImage(fixture.image, { id: 'pending' });
    const availability = computed(() => getEnFaceAvailability('pending'));
    expect(availability.value.available).toBe(false);
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    await nextTick();
    expect(availability.value.reason).toMatch(/complete volume/);
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded('pending');
    await nextTick();
    expect(availability.value.available).toBe(true);
    expect(availability.value.reason).toBeNull();
    expect(availability.value.measurementGeometryReason).toBeNull();
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
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: false,
      });
      expect(getEnFaceAvailability(id).reason).toMatch(reason);
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
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      measurementGeometryReason: null,
    });
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
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        measurementGeometryReason: null,
      });
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
      const availability = getEnFaceAvailability('guarded');
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(
        kind === 'radial' ? /reconstruction/ : /unsuitable/
      );
    }
  );

  it('keeps the source volume renderable when declared padding cannot be interpreted for measurements', async () => {
    const fixture = createOCTFixture();
    const id = useImageCacheStore().addProgressiveImage(fixture.image);
    await fixture.chunk.loadMeta();
    fixture.chunk.metadata!.push([Tags.PixelPaddingValue, 'invalid']);
    await fixture.image.addChunks([fixture.chunk]);
    fixture.image.startLoad();
    await untilLoaded(id);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      reason: null,
      paddingReason: expect.stringMatching(/occupied depth is unavailable/i),
      paddingRanges: undefined,
    });
  });

  it('defers metadata inspection until complete loading and reuses it for an unchanged grid', async () => {
    const fixture = createOCTFixture({ deferDecode: true });
    releaseDecode = fixture.releaseDecode;
    const id = useImageCacheStore().addProgressiveImage(fixture.image);
    await fixture.chunk.loadMeta();
    await fixture.image.addChunks([fixture.chunk]);
    const chunks = vi.spyOn(fixture.image, 'getChunks');
    expect(getEnFaceAvailability(id).available).toBe(false);
    expect(chunks).not.toHaveBeenCalled();
    fixture.image.startLoad();
    fixture.releaseDecode();
    await untilLoaded(id);
    chunks.mockClear();
    const initial = getEnFaceAvailability(id);
    const repeated = getEnFaceAvailability(id);
    expect(initial.available).toBe(true);
    expect(repeated).toEqual(initial);
    expect(chunks).toHaveBeenCalledTimes(1);
    fixture.image.getVtkImageData().setSpacing([1, 1, 1]);
    expect(getEnFaceAvailability(id).calibratedAxes).toEqual([
      false,
      false,
      false,
    ]);
    expect(chunks).toHaveBeenCalledTimes(2);
  });

  it('preserves declared ultrasound-region calibration without PixelSpacing', async () => {
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
          regionCount: 1,
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
    expect(getEnFaceAvailability(id).calibratedAxes).toEqual([
      true,
      true,
      true,
    ]);
  });
});
