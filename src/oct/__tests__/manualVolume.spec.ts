import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL as FileURL, fileURLToPath } from 'node:url';
import dicomParser from 'dicom-parser';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { readImageNode } from '@itk-wasm/image-io';
import { gzipSync } from 'node:zlib';
import {
  createNrrdVolume,
  createNiftiVolume,
  publicOCTVolume,
} from '@/tests/fixtures/oct/volumes';
import { convertItkToVtkImage } from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { imageHeaderMetadata } from '@/src/io/imageHeaderMetadata';
import { repairUnusableSpacing } from '@/src/utils/imageSpace';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getOCTAvailability } from '@/src/oct/availability';
import { projectEnFace } from '@/src/oct/projection';

// Use public OCT intensities with tiny format fixtures; both readers decode the
// actual file bytes through their installed WASM pipelines, without mocks.
const dicomBytes = Uint8Array.from(
  readFileSync(
    new FileURL(
      '../../../tests/fixtures/oct/retina-derived.dcm',
      import.meta.url
    )
  )
);
const dicom = dicomParser.parseDicom(dicomBytes);
const sourcePixels = new DataView(
  dicomBytes.buffer,
  dicom.elements.x7fe00010.dataOffset,
  24
);
const samples = Uint16Array.from({ length: 12 }, (_, index) =>
  sourcePixels.getUint16(index * 2, true)
);
const dimensions = [2, 3, 2];

function nrrd(units: string[]) {
  return new File(
    [
      createNrrdVolume({
        scalars: samples,
        dimensions,
        spacing: [0.03, 0.01, 0.2],
        origin: [1, 2, 3],
        units,
        metadata: { Segment0_Name: 'Retinal layer' },
      }),
    ],
    'retina.nrrd'
  );
}
function nifti(units: number, spacing = [0.03, 0.01, 0.2], sformCode = 1) {
  return new File(
    [
      createNiftiVolume({
        scalars: samples,
        dimensions,
        spacing,
        origin: [-1, -2, 3],
        direction: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
        units,
        sformCode,
      }),
    ],
    'retina.nii'
  );
}
function projectionVolume(data: vtkImageData) {
  return {
    dimensions: data.getDimensions(),
    spacing: data.getSpacing(),
    scalars: data.getPointData().getScalars().getData(),
  };
}
describe('manual En face with real generic image readers', () => {
  let directory: string;
  let paths: string[];
  beforeEach(() => {
    setActivePinia(createPinia());
    directory = mkdtempSync(join(tmpdir(), 'volview-oct-reader-'));
    paths = [];
  });
  afterEach(async () => {
    const cache = useImageCacheStore();
    [...cache.imageIds].forEach((id) => cache.removeImage(id));
    await nextTick();
    paths.forEach((path) => unlinkSync(path));
    rmdirSync(directory);
  });

  async function load(file: File) {
    const path = join(directory, `${paths.length}-${file.name}`);
    paths.push(path);
    writeFileSync(path, new Uint8Array(await file.arrayBuffer()));
    const itk = await readImageNode(path);
    const headerMetadata = await imageHeaderMetadata(file, itk);
    const data = convertItkToVtkImage(itk);
    repairUnusableSpacing(data);
    const id = useImageCacheStore().addVTKImageData(data, file.name, {
      headerMetadata,
    });
    return { id, data, headerMetadata };
  }

  it('renders explicit-mm NRRD while retaining declared geometry and custom metadata', async () => {
    const { id, data, headerMetadata } = await load(nrrd(['mm', 'mm', 'mm']));
    expect(getOCTAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
      calibratedAxes: [true, true, true],
    });
    expect(data.getDimensions()).toEqual(dimensions);
    expect(data.getSpacing()).toEqual([0.03, 0.01, 0.2]);
    expect(data.getOrigin()).toEqual([1, 2, 3]);
    expect(data.getDirection()).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(headerMetadata.get('Segment0_Name')).toBe('Retinal layer');
    const projection = projectEnFace({
      volume: projectionVolume(data),
      axis: 1,
      method: 'mean',
      depthStart: 0,
      depthEnd: 2,
    });
    expect(Array.from(projection.values)).toEqual(
      [0, 1, 6, 7].map((offset) =>
        Math.fround(
          (samples[offset] + samples[offset + 2] + samples[offset + 4]) / 3
        )
      )
    );
  });

  it.each([{ units: [] }, { units: ['um', 'um', 'um'] }])(
    'keeps unknown or non-mm NRRD units projection-only: %j',
    async ({ units }) => {
      const { id, data } = await load(nrrd(units));
      expect(getOCTAvailability(id)).toMatchObject({
        available: true,
        isOCT: false,
        calibratedAxes: [false, false, false],
      });
      expect(data.getSpacing()).toEqual([0.03, 0.01, 0.2]);
      expect(data.getOrigin()).toEqual([1, 2, 3]);
    }
  );

  it('calibrates only NRRD axes whose direction has declared millimeter components', async () => {
    const { id } = await load(nrrd(['mm', 'mm', 'unknown']));
    expect(getOCTAvailability(id).calibratedAxes).toEqual([true, true, false]);
  });

  it.each([1, 2, 3, 10])(
    'uses NIfTI normalized millimeters for spatial unit code %i',
    async (units) => {
      const { id, data } = await load(nifti(units));
      expect(getOCTAvailability(id)).toMatchObject({
        available: true,
        isOCT: false,
        calibratedAxes: [true, true, true],
      });
      const scale =
        [1, 2, 3].indexOf(units & 7) === 0
          ? 1000
          : (units & 7) === 3
            ? 0.001
            : 1;
      expect(data.getSpacing()[1]).toBeCloseTo(Math.fround(0.01) * scale, 9);
      expect(data.getOrigin()).toEqual([-scale, -2 * scale, 3 * scale]);
      expect(Array.from(data.getDirection(), (value) => value || 0)).toEqual([
        -1, 0, 0, 0, -1, 0, 0, 0, 1,
      ]);
      const projection = projectEnFace({
        volume: projectionVolume(data),
        axis: 1,
        method: 'mean',
        depthStart: 0,
        depthEnd: 2,
        segmentation: {
          dimensions,
          scalars: new Uint8Array(12).fill(1),
          thresholdMicrons: 0,
        },
      });
      expect(projection.thicknessMicrons![0]).toBeCloseTo(
        Math.fround(0.01) * scale * 1000 * 3,
        4
      );
    }
  );

  it('renders NIfTI without declared units without inventing physical calibration', async () => {
    const { id } = await load(nifti(0));
    expect(getOCTAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
      calibratedAxes: [false, false, false],
    });
  });

  it('does not treat repaired NIfTI spacing as physical calibration', async () => {
    const { id, data } = await load(nifti(2, [0.03, 0, 0.2], 0));
    expect(data.getSpacing()[1]).toBeGreaterThan(0);
    expect(getOCTAvailability(id).calibratedAxes).toEqual([true, false, true]);
  });
  it('inspects a gzip NIfTI header without losing calibrated sampling', async () => {
    const uncompressed = nifti(2);
    const compressed = new File(
      [gzipSync(new Uint8Array(await uncompressed.arrayBuffer()))],
      'retina.nii.gz'
    );
    const { id, data } = await load(compressed);
    expect(getOCTAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
      calibratedAxes: [true, true, true],
    });
    expect(Array.from(data.getPointData().getScalars().getData())).toEqual(
      Array.from(samples)
    );
  });

  it('overwrites a source-provided calibration marker with independently inspected units', async () => {
    const file = new File(
      [
        createNrrdVolume({
          scalars: samples,
          dimensions,
          spacing: [0.03, 0.01, 0.2],
          units: [],
          metadata: { 'volview:calibrated-spacing-axes': '1,1,1' },
        }),
      ],
      'untrusted.nrrd'
    );
    const { id } = await load(file);
    expect(getOCTAvailability(id).calibratedAxes).toEqual([
      false,
      false,
      false,
    ]);
  });

  it.each(['nrrd', 'nii'] as const)(
    'preserves the public retinal volume geometry when A-lines use another voxel axis: %s',
    async (format) => {
      const source = new FileURL(
        '../../../tests/fixtures/oct/retina-derived.dcm',
        import.meta.url
      );
      const reference = JSON.parse(
        readFileSync(
          new FileURL(
            '../../../tests/fixtures/oct/reference.json',
            import.meta.url
          ),
          'utf8'
        )
      );
      const { id, data } = await load(
        new File(
          [publicOCTVolume(fileURLToPath(source), format)],
          `retina.${format}`
        )
      );
      expect(getOCTAvailability(id)).toMatchObject({
        available: true,
        isOCT: false,
        calibratedAxes: [true, true, true],
      });
      expect(data.getDimensions()).toEqual([128, 32, 222]);
      expect(Array.from(data.getDirection(), (value) => value || 0)).toEqual([
        1, 0, 0, 0, 0, 1, 0, 1, 0,
      ]);
      const projection = projectEnFace({
        volume: projectionVolume(data),
        axis: 2,
        method: 'mean',
        depthStart: 0,
        depthEnd: 221,
      });
      reference.points.forEach(
        ({ x, z }: { x: number; z: number }, index: number) => {
          expect(projection.values[z * 128 + x]).toBe(
            Math.fround(reference.projections.mean[index])
          );
        }
      );
    }
  );
  it('does not confuse NRRD custom key/value metadata with declared space units', async () => {
    const bytes = createNrrdVolume({
      scalars: samples,
      dimensions,
      spacing: [0.03, 0.01, 0.2],
      units: [],
      metadata: { 'space units': '"mm" "mm" "mm"' },
    });
    const { id } = await load(new File([bytes], 'custom-units.nrrd'));
    expect(getOCTAvailability(id).calibratedAxes).toEqual([
      false,
      false,
      false,
    ]);
  });
});
