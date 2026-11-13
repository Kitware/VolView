import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { Tags, type Instance } from '@/packages/dicom/core';
import {
  cineInstance,
  TS_JPEG_BASELINE,
} from '@/src/core/cine/__tests__/cineFixtures';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { imageFactory } from '@/src/store/__tests__/dicomImportFixtures';
import { useDICOMStore } from '@/src/store/datasets-dicom';

const SERIES = {
  [Tags.SeriesNumber]: '7',
  [Tags.SeriesDescription]: 'Unsupported native cine',
};

// MONOCHROME1 native pixels are a clip the cine player does not support.
const unsupported = () =>
  cineInstance({
    ...SERIES,
    [Tags.PhotometricInterpretation]: 'MONOCHROME1',
  });

const onlyId = (volumes: Record<string, Instance[]>) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

describe('DICOM store cine routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('imports a clip the cine player does not support as a volume', () => {
    const { created, createImage } = imageFactory();
    const clip = unsupported();

    const store = useDICOMStore();
    const result = store.importInstances([clip], { createImage });

    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([clip]);

    const id = onlyId(result.volumes);
    expect(result.volumes[id]).toEqual([clip]);
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

  it('plays a clip as cine from its header alone, whatever its pixels hold', () => {
    const { created, createImage } = imageFactory();
    const malformed = cineInstance(
      {},
      { transferSyntaxUid: TS_JPEG_BASELINE, pixels: new Uint8Array(8) }
    );

    const store = useDICOMStore();
    const id = onlyId(
      store.importInstances([malformed], { createImage }).volumes
    );

    expect(created).toHaveLength(0);
    expect(store.volumeInfo[id].kind).toBe('cine');
    expect(useImageCacheStore().imageById[id]).toBeInstanceOf(DicomCineImage);
  });

  it('reuses an unsupported cine clip that already loaded as a volume', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();
    const first = store.importInstances([unsupported()], { createImage });
    const repeated = store.importInstances([unsupported()], { createImage });
    expect(Object.keys(repeated.volumes)).toEqual(Object.keys(first.volumes));
    expect(created).toHaveLength(1);
  });

  it('refuses to reuse a cached image that is not a DICOM volume', () => {
    const normalClip = () =>
      cineInstance({
        [Tags.SOPClassUID]: '1.2.840.10008.5.1.4.1.1.2',
        [Tags.NumberOfFrames]: '1',
      });

    const learner = imageFactory();
    const learned = useDICOMStore().importInstances([normalClip()], {
      createImage: learner.createImage,
    });
    const id = onlyId(learned.volumes);

    // A fresh session plans the same id, but the cache holds a foreign image.
    setActivePinia(createPinia());
    const imageCacheStore = useImageCacheStore();
    imageCacheStore.imageById[id] =
      {} as (typeof imageCacheStore.imageById)[string];

    const { created, createImage } = imageFactory();
    expect(() =>
      useDICOMStore().importInstances([normalClip()], { createImage })
    ).toThrow(/non-DICOM/);
    expect(created).toHaveLength(0);
  });
});

it('imports two same-shaped ultrasound clips as separate playable cine volumes', () => {
  setActivePinia(createPinia());
  const clips = ['clip-1', 'clip-2'].map((sop) =>
    cineInstance({ [Tags.SOPInstanceUID]: sop })
  );
  const { created, createImage } = imageFactory();
  const store = useDICOMStore();
  const result = store.importInstances(clips, { createImage });
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
