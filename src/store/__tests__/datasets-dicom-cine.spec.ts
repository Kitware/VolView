import { datasetFromTags } from '@/tests/dicomDataset';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  SOP_CLASS_ULTRASOUND_MULTIFRAME,
  SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED,
  Tags,
} from '@/packages/dicom/core/metadata/dicomTags';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import { instanceFor } from '@/packages/dicom/core/instance/__tests__/instanceFixture';
import { fromBlob } from '@/packages/dicom/core/source/byteSource';
import type { CineParseResult } from '@/src/core/cine/parseCineDicom';
import {
  cineHeader,
  cineParseResult,
} from '@/src/core/cine/__tests__/cineFixtures';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { instanceTags } from '@/src/store/__tests__/dicomTagFixtures';
import { imageFactory } from '@/src/store/__tests__/dicomImportFixtures';
import { isCineInstance, useDICOMStore } from '@/src/store/datasets-dicom';

// Pixel tags let a clip that is not played as cine load as a volume instead.
const PIXEL_TAGS: Array<[string, string]> = [
  [Tags.Rows, '2'],
  [Tags.Columns, '2'],
  [Tags.SamplesPerPixel, '1'],
  [Tags.BitsStored, '8'],
  [Tags.PixelRepresentation, '0'],
];

function metadata(overrides: Record<string, string> = {}) {
  return [
    ...instanceTags({
      sopClassUid: SOP_CLASS_ULTRASOUND_MULTIFRAME,
      numberOfFrames: '2',
      sopInstanceUid: 'sop-uid',
      modality: 'US',
      seriesDescription: 'Unsupported native cine',
    }),
    ...PIXEL_TAGS,
  ].map(([tag, value]) => [tag, overrides[tag] ?? value]) as [string, string][];
}

// MONOCHROME1 native pixels are a clip the cine player does not support.
const unsupportedHeader = () =>
  cineHeader({ photometricInterpretation: 'MONOCHROME1' });

const clip = (meta = metadata()): Instance =>
  instanceFor(datasetFromTags(meta), fromBlob(new Blob([new Uint8Array([2])])));

const onlyId = (volumes: Record<string, Instance[]>) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

describe('isCineInstance', () => {
  it('accepts a single current ultrasound multi-frame image with more than one frame', () => {
    expect(isCineInstance(clip().dataset)).toBe(true);
  });

  it('accepts the retired ultrasound multi-frame SOP class UID', () => {
    expect(
      isCineInstance(
        clip(
          metadata({
            [Tags.SOPClassUID]: SOP_CLASS_ULTRASOUND_MULTIFRAME_RETIRED,
          })
        ).dataset
      )
    ).toBe(true);
  });

  it('rejects non-ultrasound SOP classes', () => {
    expect(
      isCineInstance(
        clip(
          metadata({
            [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2',
          })
        ).dataset
      )
    ).toBe(false);
  });

  it('rejects single-frame images', () => {
    expect(
      isCineInstance(
        clip(
          metadata({
            [Tags.NumberOfFrames]: '1',
          })
        ).dataset
      )
    ).toBe(false);
  });
});

describe('DICOM store cine routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('falls back to volume import for unsupported parsed cine headers', async () => {
    const { created, createImage } = imageFactory();
    const parseCineDicom = vi.fn(() => cineParseResult(unsupportedHeader()));
    const unsupported = clip();

    const store = useDICOMStore();
    const result = await store.importInstances([unsupported], {
      createImage,
      parseCineDicom,
    });

    expect(parseCineDicom).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([unsupported]);

    const id = onlyId(result.volumes);
    expect(result.volumes[id]).toEqual([unsupported]);
    expect(useImageCacheStore().imageById[id]).toBe(created[0]);
    expect(store.volumeInfo[id]).toMatchObject({
      NumberOfSlices: 2,
      VolumeID: id,
      Modality: 'US',
      SeriesInstanceUID: 'series-uid',
      SeriesNumber: '7',
      SeriesDescription: 'Unsupported native cine',
      kind: 'volume',
    });
  });

  it('falls back to volume import when cine parsing throws', async () => {
    const { created, createImage } = imageFactory();
    const parseCineDicom = vi.fn((): CineParseResult => {
      throw new Error('unsupported encapsulated frame layout');
    });
    const malformed = clip();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = useDICOMStore();
    const result = await store
      .importInstances([malformed], { createImage, parseCineDicom })
      .finally(() => warn.mockRestore());

    expect(parseCineDicom).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([malformed]);

    const id = onlyId(result.volumes);
    expect(useImageCacheStore().imageById[id]).toBe(created[0]);
    expect(store.volumeInfo[id].kind).toBe('volume');
  });

  it('reuses an unsupported cine clip that already loaded as a volume', async () => {
    const { created, createImage } = imageFactory();
    const parseCineDicom = () => cineParseResult(unsupportedHeader());
    const store = useDICOMStore();
    const first = await store.importInstances([clip()], {
      createImage,
      parseCineDicom,
    });
    const repeated = await store.importInstances([clip()], {
      createImage,
      parseCineDicom,
    });
    expect(Object.keys(repeated.volumes)).toEqual(Object.keys(first.volumes));
    expect(created).toHaveLength(1);
  });

  it('refuses to reuse a cached image that is not a DICOM volume', async () => {
    const parseCineDicom = vi.fn(() => cineParseResult(unsupportedHeader()));
    const normalClip = () =>
      clip(
        metadata({
          [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2',
          [Tags.NumberOfFrames]: '1',
        })
      );

    const learner = imageFactory();
    const learned = await useDICOMStore().importInstances([normalClip()], {
      createImage: learner.createImage,
      parseCineDicom,
    });
    const id = onlyId(learned.volumes);

    // A fresh session plans the same id, but the cache holds a foreign image.
    setActivePinia(createPinia());
    const imageCacheStore = useImageCacheStore();
    imageCacheStore.imageById[id] =
      {} as (typeof imageCacheStore.imageById)[string];

    const { created, createImage } = imageFactory();
    await expect(
      useDICOMStore().importInstances([normalClip()], {
        createImage,
        parseCineDicom,
      })
    ).rejects.toThrow(/non-DICOM/);
    expect(created).toHaveLength(0);
  });
});

it('imports two same-shaped ultrasound clips as separate playable cine volumes', async () => {
  setActivePinia(createPinia());
  const clips = ['clip-1', 'clip-2'].map((sop) =>
    clip(metadata({ [Tags.SOPInstanceUID]: sop }))
  );
  const { created, createImage } = imageFactory();
  const store = useDICOMStore();
  const result = await store.importInstances(clips, {
    createImage,
    parseCineDicom: () => cineParseResult(cineHeader()),
  });
  expect(
    Object.values(result.volumes).map((members) => members.length)
  ).toEqual([1, 1]);
  expect(Object.values(store.volumeInfo).map((info) => info.kind)).toEqual([
    'cine',
    'cine',
  ]);
  expect(
    Object.keys(result.volumes).map(
      (id) => useImageCacheStore().imageById[id] instanceof DicomCineImage
    )
  ).toEqual([true, true]);
  expect(created).toHaveLength(0);
});
