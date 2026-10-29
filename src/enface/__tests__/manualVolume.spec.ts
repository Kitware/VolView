import reference from '@/tests/fixtures/oct/reference.json';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { readImageNode } from '@itk-wasm/image-io';
import { gzipSync } from 'node:zlib';
import {
  createNrrdVolume,
  createNiftiVolume,
  syntheticOCTVolume,
} from '@/tests/fixtures/oct/volumes';
import { convertItkToVtkImage } from '@/src/io/convertItkToVtkImage';
import { repairUnusableSpacing } from '@/src/utils/imageSpace';
import { useImageCacheStore } from '@/src/store/image-cache';
import { getEnFaceAvailability } from '@/src/enface/availability';

const samples = Uint16Array.from({ length: 12 }, (_, index) => index);
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
function singletonNrrd(componentAxis: number, units: string[]) {
  const sizes = [...dimensions];
  sizes.splice(componentAxis, 0, 1);
  const kinds = ['domain', 'domain', 'domain'];
  kinds.splice(componentAxis, 0, 'vector');
  const directions = ['(0.03,0,0)', '(0,0.01,0)', '(0,0,0.2)'];
  directions.splice(componentAxis, 0, 'none');
  const header = [
    'NRRD0005',
    'type: unsigned short',
    'dimension: 4',
    `sizes: ${sizes.join(' ')}`,
    `kinds: ${kinds.join(' ')}`,
    'space: left-posterior-superior',
    `space directions: ${directions.join(' ')}`,
    `space units: ${units.map((unit) => `"${unit}"`).join(' ')}`,
    'space origin: (1,2,3)',
    'encoding: raw',
    'endian: little',
    '',
    '',
  ].join('\n');
  return new File([header, samples], 'singleton-vector.nrrd');
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
    const headerMetadata = new Map(
      Array.from(itk.metadata ?? [], ([key, value]) => [key, String(value)])
    );
    const data = convertItkToVtkImage(itk);
    repairUnusableSpacing(data);
    const id = useImageCacheStore().addVTKImageData(data, file.name, {
      headerMetadata,
    });
    return { id, data, headerMetadata };
  }

  it('loads explicit-mm NRRD while retaining declared geometry and custom metadata', async () => {
    const { id, data, headerMetadata } = await load(nrrd(['mm', 'mm', 'mm']));
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
    });
    expect(data.getDimensions()).toEqual(dimensions);
    expect(data.getSpacing()).toEqual([0.03, 0.01, 0.2]);
    expect(data.getOrigin()).toEqual([1, 2, 3]);
    expect(data.getDirection()).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(headerMetadata.get('Segment0_Name')).toBe('Retinal layer');
    expect(Array.from(data.getPointData().getScalars().getData())).toEqual(
      Array.from(samples)
    );
  });

  it.each([{ units: [] }, { units: ['um', 'um', 'um'] }])(
    'uses loaded NRRD geometry regardless of declared units: %j',
    async ({ units }) => {
      const { id, data } = await load(nrrd(units));
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        isOCT: false,
      });
      expect(data.getSpacing()).toEqual([0.03, 0.01, 0.2]);
      expect(data.getOrigin()).toEqual([1, 2, 3]);
    }
  );

  it.each([0, 1, 3])(
    'matches scalar geometry after decoding a singleton component at file axis %i',
    async (componentAxis) => {
      for (const units of [
        ['mm', 'mm', 'mm'],
        ['mm', 'um', 'mm'],
      ]) {
        const scalar = await load(nrrd(units));
        const vector = await load(singletonNrrd(componentAxis, units));
        expect(vector.data.getDimensions()).toEqual(dimensions);
        expect(vector.data.getSpacing()).toEqual(scalar.data.getSpacing());
        expect(vector.data.getOrigin()).toEqual(scalar.data.getOrigin());
        expect(vector.data.getDirection()).toEqual(scalar.data.getDirection());
        expect(
          Array.from(vector.data.getPointData().getScalars().getData())
        ).toEqual(Array.from(samples));
      }
    }
  );

  it('loads per-axis NRRD spacing', async () => {
    const header = [
      'NRRD0005',
      'type: unsigned short',
      'dimension: 3',
      'sizes: 2 3 2',
      'spacings: 0.03 0.01 0.2',
      'units: "mm" "mm" "mm"',
      'encoding: raw',
      'endian: little',
      '',
      '',
    ].join('\n');
    const { id, data } = await load(
      new File([header, samples], 'axis-units.nrrd')
    );
    expect(data.getSpacing()).toEqual([0.03, 0.01, 0.2]);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
    });
  });

  it.each([1, 2, 3, 10])(
    'uses NIfTI normalized millimeters for spatial unit code %i',
    async (units) => {
      const { id, data } = await load(nifti(units));
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        isOCT: false,
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
    }
  );

  it('uses loaded NIfTI geometry when physical units are unspecified', async () => {
    const { id } = await load(nifti(0));
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
    });
  });

  it('uses reader-repaired NIfTI spacing consistently with the loaded image', async () => {
    const { data } = await load(nifti(2, [0.03, 0, 0.2], 0));
    expect(data.getSpacing()[1]).toBeGreaterThan(0);
  });
  it('loads gzip NIfTI with its decoded sampling', async () => {
    const uncompressed = nifti(2);
    const compressed = new File(
      [gzipSync(new Uint8Array(await uncompressed.arrayBuffer()))],
      'retina.nii.gz'
    );
    const { id, data } = await load(compressed);
    expect(getEnFaceAvailability(id)).toMatchObject({
      available: true,
      isOCT: false,
    });
    expect(Array.from(data.getPointData().getScalars().getData())).toEqual(
      Array.from(samples)
    );
  });

  it.each(['nrrd', 'nii'] as const)(
    'preserves the synthetic raster geometry when A-lines use another voxel axis: %s',
    async (format) => {
      const { id, data } = await load(
        new File([syntheticOCTVolume(format)], `retina.${format}`)
      );
      expect(getEnFaceAvailability(id)).toMatchObject({
        available: true,
        isOCT: false,
      });
      expect(data.getDimensions()).toEqual([128, 32, 222]);
      expect(Array.from(data.getDirection(), (value) => value || 0)).toEqual([
        1, 0, 0, 0, 0, 1, 0, 1, 0,
      ]);
      const scalars = data.getPointData().getScalars().getData();
      reference.points.forEach(({ x, z }, index) => {
        expect(scalars[x + 128 * z]).toBe(reference.projections.min[index]);
        expect(scalars[x + 128 * (z + 32 * 221)]).toBe(
          reference.projections.max[index]
        );
      });
    }
  );
});
