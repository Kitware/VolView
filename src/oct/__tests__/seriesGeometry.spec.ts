import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import dicomParser from 'dicom-parser';
import { Chunk } from '@/src/core/streaming/chunk';
import { DicomFileMetaLoader } from '@/src/core/streaming/dicom/dicomFileMetaLoader';
import { DicomFileDataLoader } from '@/src/core/streaming/dicom/dicomFileDataLoader';
import { Tags } from '@/src/core/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { createOCTFixture } from '@/tests/unit/octFixture';
import { buildSyntheticDicom } from '@/tests/specs/syntheticDicom';
import { getOCTAvailability } from '@/src/oct/availability';
import { OCT_GEOMETRY_ERROR, OCT_SCAN_PATTERN } from '@/src/oct/detection';
import { octSeriesGeometry } from '@/src/oct/seriesGeometry';
import { projectEnFace } from '@/src/oct/projection';

async function readTags(file: File) {
  const data = dicomParser.parseDicom(new Uint8Array(await file.arrayBuffer()));
  return Object.values(Tags).reduce<Array<[string, string]>>((tags, tag) => {
    const key = 'x' + tag.replace('|', '');
    const attribute = data.elements[key];
    if (attribute && attribute.vr !== 'SQ') {
      const value = attribute.vr === 'US' ? data.uint16(key) : data.string(key);
      if (value !== undefined) tags.push([tag, String(value)]);
    }
    return tags;
  }, []);
}

describe('assembled OCT series through real chunk and file collaborators', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach((id) => cache.removeImage(id));
  });

  async function assemble(
    positions = [0, 0.2, 0.4],
    change?: (chunks: Chunk[]) => void
  ) {
    const chunks = positions.map((z, index) => {
      const bytes = buildSyntheticDicom({
        studyUid: '1.2.3.1',
        seriesUid: '1.2.3.2',
        sopUid: '1.2.3.3.' + index,
        instanceNumber: index + 1,
        modality: 'OPT',
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, z],
        pixelSpacing: [0.0104, 0.02],
        rows: 2,
        cols: 2,
        pixelValue: index + 1,
      });
      const file = new File([Uint8Array.from(bytes)], 'oct-' + index + '.dcm');
      return new Chunk({
        metaLoader: new DicomFileMetaLoader(file, readTags),
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

  it('derives calibrated slow spacing from complete uniform positions when optional spacing is absent', async () => {
    const { id, image } = await assemble();
    const data = image.getVtkImageData();
    expect(data.getDimensions()).toEqual([2, 2, 3]);
    expect(getOCTAvailability(id)).toMatchObject({
      available: true,
      calibratedAxes: [true, true, true],
    });
    expect(data.getSpacing()[2]).toBeCloseTo(0.2, 7);
    const result = projectEnFace({
      volume: {
        dimensions: data.getDimensions(),
        spacing: data.getSpacing(),
        scalars: data.getPointData().getScalars().getData(),
      },
      axis: 1,
      method: 'mean',
      depthStart: 0,
      depthEnd: 1,
      segmentation: {
        dimensions: data.getDimensions(),
        scalars: new Uint8Array(12).fill(1),
        thresholdMicrons: 20.8,
      },
    });
    expect([...result.values]).toEqual([1, 1, 2, 2, 3, 3]);
    expect([...result.thicknessMicrons!]).toEqual(Array(6).fill(20.8));
    expect([...result.thinMask!]).toEqual(Array(6).fill(0));
  });

  it('rejects nonuniform positions that the allocator otherwise replaces with average spacing', async () => {
    const { id, image } = await assemble([0, 0.1, 0.4]);
    expect(image.getVtkImageData().getSpacing()[2]).toBeCloseTo(0.2, 7);
    expect(getOCTAvailability(id)).toMatchObject({
      available: false,
      calibratedAxes: [false, false, false],
    });
    expect(getOCTAvailability(id).reason).toMatch(/nonuniform/);
  });

  it.each([
    [Tags.OphthalmicVolumetricPropertiesFlag, 'NO', /unsuitable/],
    [OCT_SCAN_PATTERN, '128282', /scan pattern/],
    [OCT_GEOMETRY_ERROR, 'Later OCT spatial metadata is corrupt.', /corrupt/],
    [Tags.PixelSpacing, '0.02\\0.02', /pixel spacing/],
    [Tags.ImageOrientationPatient, '0\\1\\0\\1\\0\\0', /orientation/],
    [Tags.ImageOrientationPatient, '2\\0\\0\\0\\1\\0', /orientation/],
    [Tags.SpacingBetweenSlices, '0.3', /slice spacing/],
  ])('checks later file declaration %s', async (tag, value, reason) => {
    const { id } = await assemble(undefined, (chunks) =>
      chunks[2].metadata!.push([tag, value])
    );
    expect(getOCTAvailability(id).available).toBe(false);
    expect(getOCTAvailability(id).reason).toMatch(reason);
  });

  it.each([false, true])(
    'requires complete positions rather than declaring a fallback calibrated: allMissing=%s',
    async (allMissing) => {
      const { id } = await assemble(undefined, (chunks) => {
        const selected = allMissing ? chunks : [chunks[1]];
        selected.forEach((chunk) => {
          const index = chunk.metadata!.findIndex(
            ([tag]) => tag === Tags.ImagePositionPatient
          );
          chunk.metadata!.splice(index, 1);
        });
      });
      expect(getOCTAvailability(id)).toMatchObject({
        available: false,
        calibratedAxes: [false, false, false],
      });
      expect(getOCTAvailability(id).reason).toMatch(/incomplete/);
    }
  );

  it('rejects disagreement with the actual loaded grid', async () => {
    const { id, image } = await assemble();
    image.getVtkImageData().setSpacing([0.02, 0.0104, 1]);
    expect(getOCTAvailability(id).reason).toMatch(/loaded OCT grid/);
  });

  it('preserves independently valid single-file calibration while excluding a repaired axis', () => {
    const metadata: Array<[string, string]> = [
      [Tags.PixelSpacing, '0.0104'],
      [Tags.SpacingBetweenSlices, '0.2'],
    ];
    const grid = {
      spacing: [1, 0.0104, 0.2],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: [0, 0, 0],
    };
    expect(octSeriesGeometry([metadata], grid).calibratedAxes).toEqual([
      false,
      true,
      true,
    ]);
  });
});
