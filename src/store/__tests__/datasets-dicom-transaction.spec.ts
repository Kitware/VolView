import { Tags } from '@/src/dicom/core/metadata/dicomTags';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useImageCacheStore } from '@/src/store/image-cache';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { useDICOMStore, getDisplayName } from '@/src/store/datasets-dicom';
import {
  ALLOCATION_FAILURE,
  cineFor,
  imageFactory,
  membersOf,
  onlyFailure,
  onlyId,
  SERIES_UID,
  sliceFor,
  splitting,
  STUDY_UID,
  unallocatableFor,
} from '@/src/store/__tests__/dicomImportFixtures';

const cachedIds = () => Object.keys(useImageCacheStore().imageById);

/** Loads the pair a later batch splits into two fresh collections. */
const loadSplittablePair = () => {
  const instances = splitting();
  const loaded = imageFactory();
  const store = useDICOMStore();
  const id = onlyId(
    store.importInstances([instances.one, instances.three], {
      createImage: loaded.createImage,
    })
  );
  return { ...instances, store, loaded, id };
};

/** Loads and decodes one slice, then fails a batch that grows it and adds a scout. */
const growAndFail = async () => {
  const { created, createImage } = imageFactory();
  const store = useDICOMStore();
  const first = sliceFor({ sop: 'a', z: 0 });
  const id = onlyId(store.importInstances([first], { createImage }));
  await untilLoaded(id);
  const shown = created[0].getVtkImageData();

  expect(
    onlyFailure(
      store.importInstances(
        [sliceFor({ sop: 'b', z: 1 }), unallocatableFor({ sop: 'scout' })],
        { createImage }
      )
    )
  ).toMatch(ALLOCATION_FAILURE);

  return { store, id, first, created, shown };
};

describe('DICOM store atomic series commit', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('commits nothing for a series when one of its collections fails to allocate', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();

    const result = store.importInstances(
      [
        unallocatableFor({ sop: 'scout' }),
        sliceFor({ sop: 'a', z: 0 }),
        sliceFor({ sop: 'b', z: 1 }),
      ],
      { createImage }
    );

    expect(onlyFailure(result)).toMatch(ALLOCATION_FAILURE);
    expect(result.volumes).toEqual({});

    expect(created).toEqual([]);
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.volumeStudy).toEqual({});
    expect(store.studyVolumes).toEqual({});
    expect(store.studyInfo).toEqual({});
    expect(store.patientInfo).toEqual({});
    expect(store.patientStudies).toEqual({});
  });

  it('leaves a displayed volume and its pixels unchanged when its growth fails', async () => {
    const { store, id, first, created, shown } = await growAndFail();

    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([first]);
    expect(created[0].getVtkImageData()).toBe(shown);
    expect(shown.isDeleted()).toBe(false);
    expect(Array.from(shown.getPointData().getScalars().getData())).toEqual(
      Array(16).fill(1)
    );
    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(1);
    expect(store.studyVolumes[STUDY_UID]).toEqual([id]);
  });

  it('lets the next import of the series commit after a failed batch', async () => {
    const { store, id, first, created } = await growAndFail();

    const retry = imageFactory();
    const corrected = sliceFor({ sop: 'b', z: 1 });
    const scout = sliceFor({ sop: 'scout', rows: '8' });
    const result = store.importInstances([corrected, scout], {
      createImage: retry.createImage,
    });

    // The unchanged key keeps its ID, and only the scout needs a new image.
    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(id);
    expect(retry.created).toHaveLength(1);

    const scoutId = ids.find((other) => other !== id)!;
    // Identity, not shape: the failed batch must not pin the instance it brought.
    expect(result.volumes[id]).toEqual([first, corrected]);
    expect(result.volumes[id][1]).toBe(corrected);
    expect(result.volumes[scoutId]).toEqual([scout]);
    expect(created[0].getInstances()[1]).toBe(corrected);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(store.volumeInfo[scoutId].NumberOfSlices).toBe(1);
  });

  it('keeps a dissolved volume when the split that dissolves it fails', () => {
    const { store, id, zero, two, loaded } = loadSplittablePair();

    const failing = imageFactory();
    expect(
      onlyFailure(
        store.importInstances([zero, two, unallocatableFor({ sop: 'scout' })], {
          createImage: failing.createImage,
        })
      )
    ).toMatch(ALLOCATION_FAILURE);

    expect(cachedIds()).toEqual([id]);
    expect(store.volumeInfo[id].NumberOfSlices).toBe(2);
    expect(store.studyVolumes[STUDY_UID]).toEqual([id]);
    expect(membersOf(loaded.created[0])).toEqual(['sop-1', 'sop-3']);
    expect(failing.created).toEqual([]);
  });

  it('hands a dissolved volume to the given removal', () => {
    const { store, id, zero, two } = loadSplittablePair();
    const removed: string[] = [];

    store.importInstances([zero, two], {
      createImage: imageFactory().createImage,
      removeDissolved: (dissolved) => removed.push(dissolved),
    });

    expect(removed).toEqual([id]);
    // The removal is the caller's whole, so the store evicted nothing itself.
    expect(cachedIds()).toContain(id);
    expect(store.volumeInfo[id]).toBeDefined();
  });

  it('removes the dissolved volume once the split commits', () => {
    const { store, id, zero, one, two, three } = loadSplittablePair();

    const result = store.importInstances([zero, two], {
      createImage: imageFactory().createImage,
    });

    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(id);
    expect(store.volumeInfo[id]).toBeUndefined();
    expect(cachedIds().sort()).toEqual([...ids].sort());
    expect(store.studyVolumes[STUDY_UID].sort()).toEqual([...ids].sort());
    expect(ids.map((each) => store.volumeInfo[each].NumberOfSlices)).toEqual([
      2, 2,
    ]);
    // Each half carries the provenance of the member it inherited.
    expect(Object.values(result.volumes)).toContainEqual([zero, one]);
    expect(Object.values(result.volumes)).toContainEqual([two, three]);
  });

  it('registers no cine image when a sibling collection fails', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    expect(
      onlyFailure(
        store.importInstances(
          [cineFor('cine'), unallocatableFor({ sop: 'scout' })],
          { createImage }
        )
      )
    ).toMatch(ALLOCATION_FAILURE);

    // A cine clip is planned like any other collection: it reaches no store alone.
    expect(cachedIds()).toEqual([]);
    expect(store.volumeInfo).toEqual({});
    expect(store.studyVolumes).toEqual({});
  });
});

describe('DICOM record naming', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('commits a nameless series with a usable fallback name', () => {
    const nameless = sliceFor({
      sop: 'nameless',
      tags: { [Tags.SeriesNumber]: '', [Tags.SeriesDescription]: '' },
    });
    const store = useDICOMStore();
    const { created, createImage } = imageFactory();
    const id = onlyId(store.importInstances([nameless], { createImage }));
    expect(created[0].getName()).toBe(SERIES_UID);
    expect(getDisplayName(store.volumeInfo[id])).toBe(SERIES_UID);
  });
});
