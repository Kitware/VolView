import { describe, expect, it } from 'vitest';
import { createGdcmDecoder } from '../gdcmDecoder';
import { readDicomDataset } from '../../metadata/dicomDataset';
import { instanceFor } from '@/tests/dicomDataset';
import type { DecodeUnit } from '../../pixels/pixelDecoder';
import { enhancedFixtureBytes } from '@/tests/fixtures/dicom-pages/enhancedFixtures';

const assets = {
  pipelineWorkerUrl: '/unused-worker.js',
  imageIOUrl: '/unused-image-io',
};

describe('Default DICOM decoder calibration', () => {
  it('rejects varying frame transforms before invoking GDCM', async () => {
    const bytes = enhancedFixtureBytes({
      pixelValues: [2, 2],
      transforms: [
        [1, 0],
        [2, 0],
      ],
    });
    const runs: Uint8Array[] = [];
    const gdcm = createGdcmDecoder(assets, 1, () => ({
      run: async (_name: string, data: Uint8Array) => {
        runs.push(data);
        throw new Error('GDCM ran');
      },
      reset: () => {},
    }));
    const instance = instanceFor(readDicomDataset(bytes));
    const [unit] = gdcm.decoder.plan(instance, Float32Array) as DecodeUnit[];

    await expect(
      Promise.resolve(unit.decode(bytes, new AbortController().signal))
    ).rejects.toThrow('differing modality rescale');
    expect(runs).toEqual([]);
    gdcm.dispose(new Error('done'));
  });
});
