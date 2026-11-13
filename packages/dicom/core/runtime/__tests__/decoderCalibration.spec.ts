import { describe, expect, it } from 'vitest';
import { createDicomRuntime } from '../createDicomRuntime';
import { readDicomDataset } from '../../metadata/dicomDataset';
import { instanceFor } from '../../instance/__tests__/instanceFixture';
import { enhancedFixtureBytes } from '@/tests/fixtures/dicom-consumer/enhancedFixtures';

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
    const runtime = createDicomRuntime({ assets, decodeConcurrency: 1 });
    try {
      await expect(
        runtime.decode(
          { instance: instanceFor(readDicomDataset(bytes)), bytes },
          new AbortController().signal
        )
      ).rejects.toThrow('differing modality rescale');
    } finally {
      runtime.dispose();
    }
  });
});
