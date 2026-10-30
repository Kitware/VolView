import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Chunk } from '@/src/core/streaming/chunk';
import { DicomFileMetaLoader } from '@/src/core/streaming/dicom/dicomFileMetaLoader';
import { DicomFileDataLoader } from '@/src/core/streaming/dicom/dicomFileDataLoader';
import { Tags } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { createOCTFixture, readDicomTags } from '@/tests/unit/octFixture';
import { buildSyntheticDicom } from '@/tests/specs/syntheticDicom';
import {
  getEnFaceAvailability,
  getEnFaceUnavailableReason,
} from '@/src/enface/availability';
import {
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/core/streaming/dicom/octMetadataTags';
import { dicomSeriesGeometry } from '@/src/core/streaming/dicom/seriesGeometry';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';

describe('assembled OCT series through real chunk and file collaborators', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach((id) => cache.removeImage(id));
  });

  async function assemble(
    positions = [0, 0.2, 0.4],
    change?: (chunks: Chunk[]) => void,
    modality = 'OPT'
  ) {
    const chunks = positions.map((z, index) => {
      const bytes = buildSyntheticDicom({
        studyUid: '1.2.3.1',
        seriesUid: '1.2.3.2',
        sopUid: '1.2.3.3.' + index,
        instanceNumber: index + 1,
        modality,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, z],
        pixelSpacing: [0.0104, 0.02],
        rows: 2,
        cols: 2,
        pixelValue: index + 1,
      });
      const file = new File([Uint8Array.from(bytes)], 'oct-' + index + '.dcm');
      return new Chunk({
        metaLoader: new DicomFileMetaLoader(file, readDicomTags),
        dataLoader: new DicomFileDataLoader(file),
      });
    });
    await Promise.all(chunks.map((chunk) => chunk.loadMeta()));
    change?.(chunks);
    // Existing real-pixel fixture supplies a deterministic parser/decoder; only
    // grouping is injected because production grouping needs a browser WASM worker.
    const fixture = createOCTFixture();
    fixture.chunk.dispose();
    const id = useImageCacheStore().addProgressiveImage(fixture.image);
    await fixture.image.addChunks(chunks);
    fixture.image.startLoad();
    await untilLoaded(id);
    return { id, image: fixture.image, chunks };
  }

  it('derives slow spacing from complete uniform positions when optional spacing is absent', async () => {
    const { id, image } = await assemble();
    const data = image.getVtkImageData();
    expect(data.getDimensions()).toEqual([2, 2, 3]);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      measurementGeometryReason: null,
    });
    expect(data.getSpacing()[2]).toBeCloseTo(0.2, 7);
    expect([...data.getPointData().getScalars().getData()]).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
    const result = measureOccupiedDepth({
      dimensions: data.getDimensions(),
      axis: 1,
      first: 0,
      last: 1,
      mask: {
        dimensions: data.getDimensions(),
        extent: [0, 1, 0, 1, 0, 2],
        values: new Uint8Array(12).fill(1),
      },
    });
    expect(
      Array.from(result.counts, (count) => count * data.getSpacing()[1] * 1000)
    ).toEqual(Array(6).fill(20.8));
  });

  it.each(['MR', 'CT'])(
    'keeps a grayscale %s series available with valid physical geometry',
    async (modality) => {
      const { id } = await assemble(undefined, undefined, modality);
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        measurementGeometryReason: null,
      });
    }
  );

  it('validates rounded slice positions against the complete series span', async () => {
    const positions = Array.from({ length: 19 }, (_, index) =>
      Math.fround(12.839991640791 + index * 4.3663311)
    );
    const { id } = await assemble(positions, undefined, 'MR');
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      measurementGeometryReason: null,
    });
  });

  it('accepts Float32 position rounding relative to the slice pitch', async () => {
    const positions = Array.from({ length: 31 }, (_, index) =>
      Math.fround(-1000 + index * 0.08)
    );
    const { id } = await assemble(positions, undefined, 'CT');
    expect(getEnFaceAvailability(id).measurementGeometryReason).toBeNull();
  });

  it('uses uniform file positions when optional slice spacing disagrees', async () => {
    const { id, image } = await assemble(undefined, (chunks) => {
      chunks.forEach((chunk) =>
        chunk.metadata!.push([Tags.SpacingBetweenSlices, '0.3'])
      );
    });
    expect(image.getVtkImageData().getSpacing()[2]).toBeCloseTo(0.2, 7);
    expect(getEnFaceAvailability(id).measurementGeometryReason).toBeNull();
  });

  it('accepts orthogonal direction cosines rounded to four decimals', async () => {
    const { id } = await assemble(undefined, (chunks) => {
      chunks.forEach((chunk) =>
        chunk.metadata!.push([
          Tags.ImageOrientationPatient,
          '0.9986\\0.0523\\0\\-0.0523\\0.9986\\0',
        ])
      );
    });
    expect(getEnFaceAvailability(id).measurementGeometryReason).toBeNull();
  });

  it('does not calibrate in-plane axes when every file omits pixel spacing', async () => {
    const { id } = await assemble(undefined, (chunks) => {
      chunks.forEach((chunk) => {
        const index = chunk.metadata!.findIndex(
          ([tag]) => tag === Tags.PixelSpacing
        );
        chunk.metadata!.splice(index, 1);
      });
    });
    expect(getEnFaceAvailability(id).calibratedAxes).toEqual([
      false,
      false,
      true,
    ]);
  });

  it.each([
    { positions: [0, 0.1, 0.4] },
    { positions: [0, 0.2, 0.4003, 0.6, 0.8] },
  ])(
    'keeps a nonuniform series projection-only: $positions',
    async ({ positions }) => {
      const { id, image, chunks } = await assemble(positions);
      expect(image.getVtkImageData().getSpacing()[2]).toBeCloseTo(0.2, 7);
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        reason: null,
        measurementGeometryReason: expect.stringMatching(/nonuniform/),
      });
      expect(
        dicomSeriesGeometry(chunks.map((chunk) => chunk.metadata!)).reason
      ).toMatch(/nonuniform/);
    }
  );

  it.each([
    [Tags.OphthalmicVolumetricPropertiesFlag, 'NO', /unsuitable/],
    [OCT_SCAN_PATTERN, '128282', /scan pattern/],
    [OCT_GEOMETRY_ERROR, 'Later OCT spatial metadata is corrupt.', /corrupt/],
  ])(
    'rejects an unsupported later acquisition declaration %s',
    async (tag, value, reason) => {
      const { id } = await assemble(undefined, (chunks) =>
        chunks[2].metadata!.push([tag, value])
      );
      expect(getEnFaceUnavailableReason(id)).toMatch(reason);
    }
  );

  it.each([
    [Tags.PixelSpacing, '0.02\\0.02', /pixel spacing/],
    [Tags.ImageOrientationPatient, '0\\1\\0\\1\\0\\0', /orientation/],
    [Tags.ImageOrientationPatient, '2\\0\\0\\0\\1\\0', /orientation/],
  ])(
    'keeps inconsistent %s geometry projection-only',
    async (tag, value, reason) => {
      const { id, chunks } = await assemble(undefined, (pending) =>
        pending[2].metadata!.push([tag, value])
      );
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        reason: null,
        measurementGeometryReason: expect.stringMatching(reason),
      });
      expect(
        dicomSeriesGeometry(chunks.map((chunk) => chunk.metadata!)).reason
      ).toMatch(reason);
    }
  );

  it.each([false, true])(
    'requires complete positions for occupied-depth measurements: allMissing=%s',
    async (allMissing) => {
      const { id, chunks } = await assemble(undefined, (pending) => {
        const selected = allMissing ? pending : [pending[1]];
        selected.forEach((chunk) => {
          const index = chunk.metadata!.findIndex(
            ([tag]) => tag === Tags.ImagePositionPatient
          );
          chunk.metadata!.splice(index, 1);
        });
      });
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        reason: null,
        measurementGeometryReason: expect.stringMatching(/incomplete/),
      });
      expect(
        dicomSeriesGeometry(chunks.map((chunk) => chunk.metadata!)).reason
      ).toMatch(/incomplete/);
    }
  );

  it('keeps an altered loaded grid projection-only', async () => {
    const { id, image, chunks } = await assemble();
    const data = image.getVtkImageData();
    data.setSpacing([0.02, 0.0104, 1]);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      reason: null,
      measurementGeometryReason: expect.stringMatching(/loaded.*grid/),
    });
    expect(
      dicomSeriesGeometry(
        chunks.map((chunk) => chunk.metadata!),
        {
          spacing: data.getSpacing(),
          direction: data.getDirection(),
          origin: data.getOrigin(),
        }
      ).reason
    ).toMatch(/loaded.*grid/);
  });
});
