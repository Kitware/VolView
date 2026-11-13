import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import { Tags } from '@/packages/dicom/core/metadata/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { untilLoaded } from '@/src/composables/untilLoaded';
import {
  createOCTFixture,
  readFixtureInstance,
  volumeOf,
} from '@/tests/unit/octFixture';
import { cleanupCachedImages } from '@/tests/unit/imageCacheCleanup';
import { buildSyntheticDicom } from '@/tests/specs/syntheticDicom';
import { getEnFaceUnavailableReason } from '@/src/enface/availability';
import { getOccupiedDepthSupport } from '@/src/enface/occupiedDepthSupport';
import { dicomMetadataForDisplay } from '@/src/core/streaming/dicom/octMetadata';
import { dicomSeriesGeometry } from '@/src/core/streaming/dicom/seriesGeometry';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';
import { datasetFromTags } from '@/tests/dicomDataset';
import {
  removeDicomTag,
  setDicomTag,
  setDicomSequence,
} from './dicomMetadataFixture';

const displayMetadata = (instance: Instance) =>
  new Map(dicomMetadataForDisplay(instance.dataset));

describe('assembled OCT series through real header and file collaborators', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => cleanupCachedImages([]));

  async function assemble(
    positions = [0, 0.2, 0.4],
    change?: (chunks: Instance[]) => void,
    modality = 'OPT'
  ) {
    const chunks = await Promise.all(
      positions.map((z, index) => {
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
        const file = new File(
          [Uint8Array.from(bytes)],
          'oct-' + index + '.dcm'
        );
        return readFixtureInstance(file);
      })
    );
    change?.(chunks);
    // Exercise the source geometry guards on one candidate volume, including
    // intentionally incompatible instances that collection planning would split.
    const { image } = await createOCTFixture();
    image.setVolume(volumeOf(chunks));
    const id = useImageCacheStore().addProgressiveImage(image);
    await untilLoaded(id);
    return { id, image, chunks };
  }

  it('derives slow spacing from complete uniform positions when optional spacing is absent', async () => {
    const { id, image } = await assemble();
    const data = image.getVtkImageData();
    expect(data.getDimensions()).toEqual([2, 2, 3]);
    expect(getEnFaceUnavailableReason(id)).toBeNull();
    expect(getOccupiedDepthSupport(id).reason).toBeNull();
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
      expect(getEnFaceUnavailableReason(id)).toBeNull();
      expect(getOccupiedDepthSupport(id).reason).toBeNull();
    }
  );

  it('validates rounded slice positions against the complete series span', async () => {
    const positions = Array.from({ length: 19 }, (_, index) =>
      Math.fround(12.839991640791 + index * 4.3663311)
    );
    const { id } = await assemble(positions, undefined, 'MR');
    expect(getEnFaceUnavailableReason(id)).toBeNull();
    expect(getOccupiedDepthSupport(id).reason).toBeNull();
  });

  it('accepts Float32 position rounding relative to the slice pitch', async () => {
    const positions = Array.from({ length: 31 }, (_, index) =>
      Math.fround(-1000 + index * 0.08)
    );
    const { id } = await assemble(positions, undefined, 'CT');
    expect(getOccupiedDepthSupport(id).reason).toBeNull();
  });

  it('accepts sub-0.1 mm slice positions printed to four decimal places', async () => {
    const positions = Array.from({ length: 5 }, (_, index) =>
      Number((index * 0.023125).toFixed(4))
    );
    const { id } = await assemble(positions);
    expect(getEnFaceUnavailableReason(id)).toBeNull();
    expect(getOccupiedDepthSupport(id).reason).toBeNull();
  });

  it('uses uniform file positions when optional slice spacing disagrees', async () => {
    const { id, image } = await assemble(undefined, (chunks) => {
      chunks.forEach((chunk) =>
        setDicomTag(chunk.dataset, Tags.SpacingBetweenSlices, '0.3')
      );
    });
    expect(image.getVtkImageData().getSpacing()[2]).toBeCloseTo(0.2, 7);
    expect(getOccupiedDepthSupport(id).reason).toBeNull();
  });

  it('accepts orthogonal direction cosines rounded to four decimals', async () => {
    const { id } = await assemble(undefined, (chunks) => {
      chunks.forEach((chunk) =>
        setDicomTag(
          chunk.dataset,
          Tags.ImageOrientationPatient,
          '0.9986\\0.0523\\0\\-0.0523\\0.9986\\0'
        )
      );
    });
    expect(getOccupiedDepthSupport(id).reason).toBeNull();
  });

  it('does not calibrate in-plane axes when every file omits pixel spacing', async () => {
    const { id } = await assemble(undefined, (chunks) => {
      chunks.forEach((chunk) => {
        removeDicomTag(chunk.dataset, Tags.PixelSpacing);
      });
    });
    expect(getOccupiedDepthSupport(id).calibratedAxes).toEqual([
      false,
      false,
      true,
    ]);
  });

  it.each([
    { positions: [0, 0.1, 0.4], displayedSpacing: 0.1 },
    { positions: [0, 0.2, 0.4003, 0.6, 0.8], displayedSpacing: 0.2 },
  ])(
    'keeps a nonuniform series projection-only: $positions',
    async ({ positions, displayedSpacing }) => {
      const { id, image, chunks } = await assemble(positions);
      expect(image.getVtkImageData().getSpacing()[2]).toBeCloseTo(
        displayedSpacing,
        7
      );
      expect(getEnFaceUnavailableReason(id)).toBeNull();
      expect(getOccupiedDepthSupport(id).reason).toMatch(/nonuniform/);
      expect(dicomSeriesGeometry(chunks.map(displayMetadata)).reason).toMatch(
        /nonuniform/
      );
    }
  );

  it.each([
    ['nonvolumetric', /unsuitable/],
    ['radial', /scan pattern/],
    ['invalid orientation', /orientation.*invalid/],
    ['incomplete frame geometry', /geometry.*Number of Frames/],
  ] as const)(
    'rejects an unsupported later structured acquisition: %s',
    async (kind, reason) => {
      const { id } = await assemble(undefined, (chunks) => {
        const metadata = chunks[2].dataset;
        if (kind === 'nonvolumetric')
          setDicomTag(metadata, Tags.OphthalmicVolumetricPropertiesFlag, 'NO');
        else if (kind === 'radial')
          setDicomSequence(metadata, '00221618', [
            datasetFromTags([['00080100', '128282']]),
          ]);
        else if (kind === 'invalid orientation')
          setDicomTag(
            metadata,
            Tags.ImageOrientationPatient,
            '2\\0\\0\\0\\1\\0'
          );
        else
          setDicomSequence(metadata, '52009230', [
            datasetFromTags([]),
            datasetFromTags([]),
          ]);
      });
      expect(getEnFaceUnavailableReason(id)).toMatch(reason);
    }
  );

  it.each([
    [Tags.PixelSpacing, '0.02\\0.02', /pixel spacing/],
    [Tags.ImageOrientationPatient, '0\\1\\0\\1\\0\\0', /orientation/],
  ])(
    'keeps inconsistent %s geometry projection-only',
    async (tag, value, reason) => {
      const { id, chunks } = await assemble(undefined, (pending) =>
        setDicomTag(pending[2].dataset, tag, value)
      );
      expect(getEnFaceUnavailableReason(id)).toBeNull();
      expect(getOccupiedDepthSupport(id).reason).toMatch(reason);
      expect(dicomSeriesGeometry(chunks.map(displayMetadata)).reason).toMatch(
        reason
      );
    }
  );

  it.each([false, true])(
    'requires complete positions for occupied-depth measurements: allMissing=%s',
    async (allMissing) => {
      const { id, chunks } = await assemble(undefined, (pending) => {
        const selected = allMissing ? pending : [pending[1]];
        selected.forEach((chunk) => {
          removeDicomTag(chunk.dataset, Tags.ImagePositionPatient);
        });
      });
      expect(getEnFaceUnavailableReason(id)).toBeNull();
      expect(getOccupiedDepthSupport(id).reason).toMatch(/incomplete/);
      expect(dicomSeriesGeometry(chunks.map(displayMetadata)).reason).toMatch(
        /incomplete/
      );
    }
  );

  it('keeps an altered loaded grid projection-only', async () => {
    const { id, image, chunks } = await assemble();
    const data = image.getVtkImageData();
    data.setSpacing([0.02, 0.0104, 1]);
    expect(getEnFaceUnavailableReason(id)).toBeNull();
    expect(getOccupiedDepthSupport(id).reason).toMatch(/loaded.*grid/);
    expect(
      dicomSeriesGeometry(chunks.map(displayMetadata), {
        spacing: data.getSpacing(),
        direction: data.getDirection(),
        origin: data.getOrigin(),
      }).reason
    ).toMatch(/loaded.*grid/);
  });
});
