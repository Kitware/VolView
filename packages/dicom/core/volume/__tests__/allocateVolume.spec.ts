import { describe, expect, it } from 'vitest';
import { instanceFor } from '@/tests/dicomDataset';
import { allocateVolume } from '../allocateVolume';
import { allocated, pixelSlice } from './volumeFixture';
import { plannedUpdate } from '@/tests/dicomVolumeFixtures';

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
    expect(volume.spatialMetadata.axes.map((axis) => axis.status)).toEqual([
      'declared',
      'declared',
      'derived',
    ]);
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

  it('keeps an irregular stack in order and reports why it is irregular', () => {
    const volume = allocated([0, 1, 3].map((z) => pixelSlice(z)));

    expect(volume.dimensions[2]).toBe(3);
    expect(volume.spatialMetadata.reconstruction).toEqual({
      kind: 'irregular',
      reason: 'uneven-slice-spacing',
    });
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

  it('applies the first ultrasound region as display spacing', () => {
    const { dataset, source } = pixelSlice(0, { modality: 'US' });
    const ultrasound = {
      ...instanceFor(dataset, source),
      ultrasoundRegions: {
        regionCount: 1,
        region: {
          physicalDeltaX: 0.01,
          physicalDeltaY: 0.02,
          physicalUnitsXDirection: 3,
          physicalUnitsYDirection: 3,
        },
      },
    };

    const volume = allocated([ultrasound]);

    expect(volume.spacing[0]).toBeCloseTo(0.1);
    expect(volume.spacing[1]).toBeCloseTo(0.2);
    expect(volume.warnings).toEqual([]);
  });
});
