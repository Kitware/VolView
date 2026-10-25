import { describe, expect, it } from 'vitest';
import { createDicomDecoder } from '../decoder';
import { createDicomLoader } from '../createDicomLoader';
import { readDicomDataset } from '../../metadata/dicomDataset';
import { defer } from '../../utils';
import { enhancedFixtureBytes } from '@/tests/fixtures/dicom-consumer/enhancedFixtures';

const assets = {
  pipelineWorkerUrl: '/unused-worker.js',
  imageIOUrl: '/unused-image-io',
};
const varyingFrames = () =>
  enhancedFixtureBytes({
    pixelValues: [2, 2],
    transforms: [
      [1, 0],
      [2, 0],
    ],
  });
const fileOf = (bytes: Uint8Array) =>
  new File([bytes as Uint8Array<ArrayBuffer>], 'enhanced.dcm');

describe('Default DICOM decoder calibration', () => {
  for (const create of [
    () => createDicomDecoder(assets),
    () => {
      const loader = createDicomLoader({ assets });
      return { decode: loader.readDicomImage, dispose: loader.dispose };
    },
  ]) {
    it('rejects varying frame transforms before invoking GDCM, with or without supplied metadata', async () => {
      const decoder = create();
      const bytes = varyingFrames();
      try {
        await expect(decoder.decode(fileOf(bytes))).rejects.toThrow(
          'differing modality rescale'
        );
        await expect(
          decoder.decode(fileOf(bytes), readDicomDataset(bytes))
        ).rejects.toThrow('differing modality rescale');
      } finally {
        decoder.dispose();
      }
    });
  }

  it('settles disposal while a direct decoder waits for metadata', async () => {
    const started = defer<void>();
    const metadata = defer<ReturnType<typeof readDicomDataset>>();
    const decoder = createDicomDecoder(assets, () => {
      started.resolve();
      return metadata.promise;
    });
    const bytes = varyingFrames();
    const pending = decoder.decode(fileOf(bytes));
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await started.promise;
    decoder.dispose();
    await rejected;
    metadata.resolve(readDicomDataset(bytes));
    await expect(decoder.decode(fileOf(bytes))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
