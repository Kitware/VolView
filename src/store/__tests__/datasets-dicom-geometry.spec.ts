import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Chunk } from '@/packages/dicom/core';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { Tags } from '@/packages/dicom/core';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useMessageStore } from '@/src/store/messages';
import { chunkFor } from './dicomImportFixtures';

const AXIAL = [1, 0, 0, 0, 1, 0];
const leaning = (theta: number) => [
  Math.cos(theta),
  0,
  Math.sin(theta),
  0,
  1,
  0,
];
const TILTED = leaning(0.0002);

// Slice 0 is the stray one, and is not the first its series walks.
async function slice(
  index: number,
  rows = '4',
  { stray = TILTED, pixelSpacing = '1\\1' } = {}
) {
  const { metadata } = chunkFor({
    sop: index === 1 ? '1' : `2.${index}`,
    z: index * 5,
    rows,
    orientation: (index === 0 ? stray : AXIAL).join('\\'),
    tags: { [Tags.BitsStored]: '8', [Tags.PixelSpacing]: pixelSpacing },
  });
  const chunk = new Chunk({
    metaLoader: { meta: metadata, load() {}, stop() {} },
    dataLoader: { data: new Blob([String(index)]), load() {}, stop() {} },
  });
  await chunk.loadMeta();
  return chunk;
}

const createImage = () =>
  new DicomChunkImage({
    readDicomImage: async () => ({
      image: {
        size: [4, 4, 1],
        data: new Uint8Array(16),
        imageType: { components: 1 },
      },
    }),
  });

describe('planned DICOM geometry in the image cache', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('builds on the axes most slices declare when the first spatial slice leans off them', async () => {
    const chunks = await Promise.all(
      Array.from({ length: 121 }, (_, i) => slice(i))
    );
    const image = createImage();
    const result = await useDICOMStore().importChunks(chunks, {
      createChunkImage: () => image,
    });

    expect(Object.keys(result.volumes)).toHaveLength(1);
    expect(useMessageStore().messages).toHaveLength(0);
    expect(image.getVtkImageData().getSpacing()).toEqual([1, 1, 5]);
    expect(image.getVtkImageData().getDirection()).toEqual([...AXIAL, 0, 0, 1]);
    expect(image.getVtkImageData().indexToWorld([0, 0, 120])[2]).toBe(600);
    image.dispose();
  });

  it('warns when a slice leans further off the volume axes than a sample can hide', async () => {
    // Four samples 90mm apart: a 0.001 rad lean moves the far corner 0.36mm.
    const wide = { stray: leaning(0.001), pixelSpacing: '90\\90' };
    const chunks = await Promise.all(
      Array.from({ length: 5 }, (_, i) => slice(i, '4', wide))
    );
    const image = createImage();
    await useDICOMStore().importChunks(chunks, {
      createChunkImage: () => image,
    });

    expect(image.getVtkImageData().getDirection()).toEqual([...AXIAL, 0, 0, 1]);
    expect(
      useMessageStore().messages.map((message) => message.options.details)
    ).toEqual([expect.stringContaining('not parallel to one another')]);
    image.dispose();
  });

  it('takes new axes on an incremental import and restores the old ones on rollback', async () => {
    const first = await slice(0);
    const image = createImage();
    const store = useDICOMStore();
    await store.importChunks([first], { createChunkImage: () => image });
    expect(image.getOrientation()).toEqual(TILTED);

    const rest = await Promise.all(
      Array.from({ length: 120 }, (_, i) => slice(i + 1))
    );
    const scout = await slice(122, '8');
    // A sibling collection fails preparation after this image has grown.
    await expect(
      store.importChunks([...rest, scout], {
        createChunkImage: () => {
          throw new Error('allocation failed');
        },
      })
    ).rejects.toThrow('allocation failed');
    expect(image.getChunks()).toEqual([first]);
    expect(image.getOrientation()).toEqual(TILTED);
    expect(image.getVtkImageData().getDirection().slice(0, 6)).toEqual(TILTED);

    await store.importChunks(rest);
    expect(image.getOrientation()).toEqual(AXIAL);
    expect(image.getVtkImageData().getSpacing()).toEqual([1, 1, 5]);
    image.dispose();
  });
});
