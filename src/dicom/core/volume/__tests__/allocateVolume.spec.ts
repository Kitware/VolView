import { describe, expect, it } from 'vitest';
import { allocateVolume } from '../allocateVolume';
import { allocated, pixelSlice } from './volumeFixture';
import { plannedUpdate } from '@/tests/dicomVolumeFixtures';
import { readHeader } from '@/tests/dicomSourceFixtures';
import { nativePixelDicom } from '@/tests/nativePixelDicom';
import { datasetFromTags } from '@/tests/dicomDataset';
import { Tags } from '../../metadata/dicomTags';

describe('allocateVolume', () => {
  it('allocates an empty buffer placed by the planned stack', () => {
    const members = [7, 5, 6].map((z) => pixelSlice(z));

    const volume = allocated(members);

    expect(volume.members).toEqual([members[1], members[2], members[0]]);
    expect(volume.dimensions).toEqual([4, 4, 3]);
    expect(volume.components).toBe(1);
    expect(volume.origin).toEqual([0, 0, 5]);
    expect(volume.spacing).toEqual([0.5, 0.5, 1]);
    expect(volume.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(volume.data).toBeInstanceOf(Uint16Array);
    expect(volume.data).toHaveLength(48);
    expect([...volume.loaded]).toEqual([0, 0, 0]);
    expect(Object.isFrozen(volume)).toBe(true);
  });

  it.each([
    [{ '0028|0103': '1' }, Int16Array],
    [{ '0028|1053': '0.5' }, Float32Array],
    [{ '0028|0101': '8' }, Uint8Array],
  ])('chooses the buffer type for pixel tags %j', (tags, type) => {
    const volume = allocated([
      pixelSlice(0, { tags }),
      pixelSlice(1, { tags }),
    ]);
    expect(volume.data).toBeInstanceOf(type);
  });

  it.each(['0', '-3', '2.5'])(
    'allocates one slice for an instance declaring %s frames',
    (frames) => {
      const volume = allocated([
        pixelSlice(0, { tags: { '0028|0008': frames } }),
      ]);
      expect(volume.dimensions).toEqual([4, 4, 1]);
      expect(volume.data).toHaveLength(16);
    }
  );

  it('rejects a lone native instance declaring more frames than its Pixel Data holds', async () => {
    const instance = await readHeader(
      nativePixelDicom({
        rows: 1,
        columns: 1,
        extra: [{ tag: 0x00280008, vr: 'IS', value: '40000000' }],
      })
    );
    expect(() => allocateVolume(plannedUpdate([instance]))).toThrow(
      'declares more frames than its Pixel Data holds: Pixel Data holds 2 bytes; its frames need 80000000'
    );
  });

  it('allocates a lone chroma subsampled instance, whose frames hold two bytes per pixel', async () => {
    const instance = await readHeader(
      nativePixelDicom({
        rows: 4,
        columns: 4,
        samplesPerPixel: 3,
        photometric: 'YBR_FULL_422',
        bitsAllocated: 8,
        bitsStored: 8,
        highBit: 7,
        words: new Array(32).fill(128),
      })
    );

    const volume = allocateVolume(plannedUpdate([instance]));

    expect(volume.dimensions).toEqual([4, 4, 1]);
    expect(volume.components).toBe(3);
  });

  it('keeps an irregular stack in order', () => {
    const members = [3, 0, 1].map((z) => pixelSlice(z));
    const volume = allocated(members);

    expect(volume.dimensions[2]).toBe(3);
    expect(volume.members).toEqual([members[1], members[2], members[0]]);
  });

  it('takes the planned slice spacing as given', () => {
    const update = plannedUpdate([pixelSlice(1), pixelSlice(19)]);
    const reconstruction = {
      ...update.collection.reconstruction,
      sliceSpacing: 9,
    };

    const volume = allocateVolume({
      ...update,
      collection: { ...update.collection, reconstruction },
    });

    expect(volume).toMatchObject({
      dimensions: [4, 4, 2],
      spacing: [0.5, 0.5, 9],
    });
  });

  it.each([
    {
      name: 'applies a calibrated region as display spacing',
      region: { deltaX: '0.01', deltaY: '0.02', unitsX: '3', unitsY: '3' },
      spacing: [0.1, 0.2],
      warnings: [],
    },
    {
      name: 'keeps the pixel spacing and warns for a zero delta',
      region: { deltaX: '0', deltaY: '0.02', unitsX: '3', unitsY: '3' },
      spacing: [0.5, 0.5],
      warnings: ['Invalid ultrasound calibration'],
    },
    {
      name: 'keeps the pixel spacing when one axis is not a distance',
      region: { deltaX: '0.01', deltaY: '0.02', unitsX: '3', unitsY: '4' },
      spacing: [0.5, 0.5],
      warnings: [],
    },
  ])(
    '$name for the first ultrasound region',
    ({ region, spacing, warnings }) => {
      const ultrasound = pixelSlice(0, { modality: 'US' });
      ultrasound.dataset.elements.push({
        ...datasetFromTags([[Tags.SequenceOfUltrasoundRegions, '']])
          .elements[0],
        vr: 'SQ',
        values: {
          kind: 'sequence',
          items: [
            datasetFromTags([
              [Tags.PhysicalDeltaX, region.deltaX],
              [Tags.PhysicalDeltaY, region.deltaY],
              [Tags.PhysicalUnitsXDirection, region.unitsX],
              [Tags.PhysicalUnitsYDirection, region.unitsY],
            ]),
          ],
        },
      });

      const volume = allocated([ultrasound]);

      expect(volume.spacing[0]).toBeCloseTo(spacing[0]);
      expect(volume.spacing[1]).toBeCloseTo(spacing[1]);
      expect(volume.warnings.map(([title]) => title)).toEqual(warnings);
    }
  );
});
