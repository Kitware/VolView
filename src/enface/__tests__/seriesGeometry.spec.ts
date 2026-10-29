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
import { getEnFaceAvailability } from '@/src/enface/availability';
import {
  OCT_GEOMETRY_ERROR,
  OCT_SCAN_PATTERN,
} from '@/src/core/streaming/dicom/octMetadataTags';

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

  it('derives slow spacing from complete uniform positions when optional spacing is absent', async () => {
    const { id, image } = await assemble();
    const data = image.getVtkImageData();
    expect(data.getDimensions()).toEqual([2, 2, 3]);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
    });
    expect(data.getSpacing()[2]).toBeCloseTo(0.2, 7);
    expect([...data.getPointData().getScalars().getData()]).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
  });

  it.each(['MR', 'CT'])(
    'keeps a grayscale %s series available with valid physical geometry',
    async (modality) => {
      const { id } = await assemble(undefined, undefined, modality);
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
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
    });
  });

  it('projects the assembled grid for a nonuniform series', async () => {
    const { id, image } = await assemble([0, 0.1, 0.4]);
    expect(image.getVtkImageData().getSpacing()[2]).toBeCloseTo(0.2, 7);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      reason: null,
    });
  });

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
      expect(getEnFaceAvailability(id).available).toBe(false);
      expect(getEnFaceAvailability(id).reason).toMatch(reason);
    }
  );

  it.each([
    [Tags.PixelSpacing, '0.02\\0.02', /pixel spacing/],
    [Tags.ImageOrientationPatient, '0\\1\\0\\1\\0\\0', /orientation/],
    [Tags.ImageOrientationPatient, '2\\0\\0\\0\\1\\0', /orientation/],
    [Tags.SpacingBetweenSlices, '0.3', /slice spacing/],
  ])(
    'projects the loaded grid with inconsistent %s declarations',
    async (tag, value) => {
      const { id } = await assemble(undefined, (pending) =>
        pending[2].metadata!.push([tag, value])
      );
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        reason: null,
      });
    }
  );

  it.each([false, true])(
    'projects the loaded grid with missing positions: allMissing=%s',
    async (allMissing) => {
      const { id } = await assemble(undefined, (pending) => {
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
      });
    }
  );

  it('projects an altered loaded grid', async () => {
    const { id, image } = await assemble();
    const data = image.getVtkImageData();
    data.setSpacing([0.02, 0.0104, 1]);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      reason: null,
    });
  });
});
