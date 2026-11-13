import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type DicomVolumeImage from '@/src/core/streaming/dicomVolumeImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  useDICOMStore,
  type ImportInstancesResult,
} from '@/src/store/datasets-dicom';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { mergingInstances } from '@/tests/dicomOrientationFixtures';
import {
  ALLOCATION_FAILURE,
  imageFactory,
  membersOf,
  OTHER_SERIES_UID,
  SERIES_UID,
  sliceFor,
  STUDY_UID,
  unallocatableFor,
} from '@/src/store/__tests__/dicomImportFixtures';

const onlyId = ({ volumes }: ImportInstancesResult) => {
  const ids = Object.keys(volumes);
  expect(ids).toHaveLength(1);
  return ids[0];
};

const sliceValues = (image: DicomVolumeImage) => {
  const data = image.getVtkImageData();
  const [columns, rows, slices] = data.getDimensions();
  const scalars = data.getPointData().getScalars().getData();
  return Array.from(
    { length: slices },
    (_, slice) => scalars[slice * columns * rows]
  );
};

describe('DICOM store incremental import', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('grows the image a re-import adds to and loads the new slice', async () => {
    const { created, createImage } = imageFactory();
    const first = sliceFor({ sop: 'a', z: 0 });
    const second = sliceFor({ sop: 'b', z: 1 });

    const store = useDICOMStore();
    const firstResult = store.importInstances([first], { createImage });
    const id = onlyId(firstResult);
    await untilLoaded(id);
    const secondResult = store.importInstances([second], {
      createImage,
    });
    await untilLoaded(id);

    expect(created).toHaveLength(1);
    const [image] = created;
    expect(membersOf(image)).toEqual(['a', 'b']);
    expect(sliceValues(image)).toEqual([1, 2]);
    expect(onlyId(secondResult)).toBe(id);
    expect(useImageCacheStore().imageById[id]).toBe(image);
    // Every member reports back, so the dataset's provenance stays complete.
    expect(secondResult.volumes[id]).toEqual([first, second]);
  });

  it('builds the volume in planned order, not arrival order', async () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();
    store.importInstances([sliceFor({ sop: 'b', z: 1 })], {
      createImage,
    });
    const id = onlyId(
      store.importInstances([sliceFor({ sop: 'a', z: 0 })], {
        createImage,
      })
    );
    await untilLoaded(id);

    expect(membersOf(created[0])).toEqual(['a', 'b']);
    expect(sliceValues(created[0])).toEqual([1, 2]);
  });

  it('gives one series the same volume id however it is imported', () => {
    const load = (batches: string[][]) => {
      setActivePinia(createPinia());
      const { createImage } = imageFactory();
      const store = useDICOMStore();
      return batches.reduce(
        (_, batch) =>
          onlyId(
            store.importInstances(
              batch.map((sop) => sliceFor({ sop, z: sop.charCodeAt(0) })),
              { createImage }
            )
          ),
        ''
      );
    };

    const oneBatch = load([['a', 'b', 'c']]);
    expect(load([['a'], ['b', 'c']])).toBe(oneBatch);
    expect(load([['b', 'c'], ['a']])).toBe(oneBatch);
    expect(
      load([
        ['a', 'b', 'c'],
        ['a', 'b', 'c'],
      ])
    ).toBe(oneBatch);
  });

  it('keeps one member when the same instance arrives twice', () => {
    const { created, createImage } = imageFactory();
    const original = sliceFor({ sop: 'a', z: 0 });
    const resupplied = sliceFor({ sop: 'a', z: 0 });

    const store = useDICOMStore();
    const first = store.importInstances([original], { createImage });
    const second = store.importInstances([resupplied], { createImage });

    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([original]);
    expect(second.volumes[onlyId(first)]).toEqual([resupplied]);
    expect(store.volumeInfo[onlyId(first)].NumberOfSlices).toBe(1);
  });

  it('counts every member of the volume after a re-import', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    const first = store.importInstances([sliceFor({ sop: 'a', z: 0 })], {
      createImage,
    });
    store.importInstances([sliceFor({ sop: 'b', z: 1 })], {
      createImage,
    });

    expect(store.volumeInfo[onlyId(first)].NumberOfSlices).toBe(2);
  });

  it('splits incompatible instances of one series into two volumes', () => {
    const { created, createImage } = imageFactory();
    const scout = sliceFor({ sop: 'scout', rows: '8', z: 0 });
    const slices = [sliceFor({ sop: 'a', z: 0 }), sliceFor({ sop: 'b', z: 1 })];

    const store = useDICOMStore();
    const result = store.importInstances([scout, ...slices], {
      createImage,
    });

    expect(created).toHaveLength(2);
    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(Object.values(result.volumes)).toContainEqual([scout]);
    expect(Object.values(result.volumes)).toContainEqual(slices);

    const imageCacheStore = useImageCacheStore();
    ids.forEach((id) => expect(imageCacheStore.imageById[id]).toBeDefined());
    expect(ids.map((id) => store.volumeInfo[id].NumberOfSlices).sort()).toEqual(
      [1, 2]
    );
    expect(store.studyVolumes[STUDY_UID].sort()).toEqual([...ids].sort());
  });

  it('rebuilds a removed series from the instances the re-import brings', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();
    const original = sliceFor({ sop: 'a', z: 0 });

    const id = onlyId(store.importInstances([original], { createImage }));
    useImageCacheStore().removeImage(id);
    store.deleteVolume(id);

    const resupplied = sliceFor({ sop: 'a', z: 0 });
    const reimported = onlyId(
      store.importInstances([resupplied], { createImage })
    );

    expect(reimported).toBe(id);
    expect(created).toHaveLength(2);
    // Identity, not shape: the forgotten instance is an equal but stale object.
    expect(created[1].getInstances()).toHaveLength(1);
    expect(created[1].getInstances()[0]).toBe(resupplied);
  });

  const merging = () => mergingInstances(sliceFor);

  it('drops the volume a replan dissolved', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();
    const imageCacheStore = useImageCacheStore();
    const { between, straight, tilted } = merging();

    const first = store.importInstances([straight, tilted], {
      createImage,
    });
    const ids = Object.keys(first.volumes);
    expect(ids).toHaveLength(2);

    const merged = store.importInstances([between], { createImage });
    const survivor = onlyId(merged);
    const dissolved = ids.find((id) => id !== survivor)!;

    expect(store.volumeInfo[dissolved]).toBeUndefined();
    expect(imageCacheStore.imageById[dissolved]).toBeUndefined();
    expect(store.studyVolumes[STUDY_UID]).toEqual([survivor]);
    expect(store.volumeInfo[survivor].NumberOfSlices).toBe(3);
    // The caller has to drop the dataset the dissolved id owned, and the
    // survivor has to carry the provenance of the member it inherited.
    expect(merged.dissolved).toEqual([dissolved]);
    expect(merged.volumes[survivor]).toEqual([straight, tilted, between]);
  });

  it('lets a corrected re-import replace the instance a failed import brought', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();
    expect(() =>
      store.importInstances([unallocatableFor({ sop: 'a' })], { createImage })
    ).toThrow(ALLOCATION_FAILURE);

    const corrected = sliceFor({ sop: 'a', rows: '8' });
    store.importInstances([corrected], { createImage });

    // Identity, not shape: the failed import must not pin its instance.
    expect(created).toHaveLength(1);
    expect(created[0].getInstances()).toEqual([corrected]);
    expect(created[0].getInstances()[0]).toBe(corrected);
  });

  it('keeps two series in one batch apart', () => {
    const { createImage } = imageFactory();
    const first = sliceFor({ sop: 'a', series: SERIES_UID });
    const second = sliceFor({ sop: 'b', series: OTHER_SERIES_UID });

    const store = useDICOMStore();
    const result = store.importInstances([first, second], {
      createImage,
    });

    const ids = Object.keys(result.volumes);
    expect(ids).toHaveLength(2);
    expect(
      ids.map((id) => store.volumeInfo[id].SeriesInstanceUID).sort()
    ).toEqual([SERIES_UID, OTHER_SERIES_UID].sort());
  });
});
