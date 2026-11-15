import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { Tags } from '@/packages/dicom/core/metadata/dicomTags';
import {
  cineInstance,
  TS_JPEG_BASELINE,
} from '@/src/core/cine/__tests__/cineFixtures';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  imageFactory,
  onlyId,
  sliceFor,
  STUDY_UID,
} from '@/src/store/__tests__/dicomImportFixtures';
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

beforeEach(() => setActivePinia(createPinia()));

describe('DICOM store cine routing', () => {
  it('imports a clip the cine player does not support as a volume', () => {
    const { created, createImage } = imageFactory();
    const clip = unsupported();

    const store = useDICOMStore();
    const result = store.importInstances([clip], { createImage });

    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([clip]);

    const id = onlyId(result);
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
    const id = onlyId(store.importInstances([malformed], { createImage }));

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
});

it('imports two same-shaped ultrasound clips as separate playable cine volumes', () => {
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

it('files a clip and a volume of one study under one patient', () => {
  const { createImage } = imageFactory();
  const store = useDICOMStore();
  // An odd-length value is padded with a space, which the reader keeps.
  const padded = {
    [Tags.PatientID]: 'patient-1 ',
    [Tags.StudyInstanceUID]: STUDY_UID,
  };

  store.importInstances([sliceFor({ sop: 'still', tags: padded })], {
    createImage,
  });
  store.importInstances([cineInstance(padded)], { createImage });

  expect(store.patientStudies).toEqual({ 'patient-1': [STUDY_UID] });
  expect(store.studyVolumes[STUDY_UID]).toHaveLength(2);
});
