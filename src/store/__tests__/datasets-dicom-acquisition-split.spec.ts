import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { Tags } from '@/packages/dicom/core/metadata/dicomTags';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import {
  getDisplayName,
  useDICOMStore,
  type ImportInstancesResult,
} from '@/src/store/datasets-dicom';
import {
  acquisition,
  imageFactory,
  OTHER_SERIES_UID,
  SERIES_UID,
  sliceFor,
} from '@/src/store/__tests__/dicomImportFixtures';

// Two passes interleaved along the same stretch of the slice axis.
const acquisitionOne = () => acquisition('1', [0, 2.5, 5]);
const acquisitionTwo = () => acquisition('2', [0.75, 3.25, 5.75]);

const volumeIds = (result: ImportInstancesResult) =>
  Object.keys(result.volumes).sort();

const labelsOf = (store: ReturnType<typeof useDICOMStore>) =>
  Object.values(store.volumeInfo)
    .map((info) => info.splitLabel)
    .sort();

describe('DICOM store acquisition split across imports', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('loads one series holding two overlapping passes as two labelled volumes', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    const result = store.importInstances(
      [...acquisitionOne(), ...acquisitionTwo()],
      { createImage }
    );

    expect(volumeIds(result)).toHaveLength(2);
    expect(labelsOf(store)).toEqual(['acquisition 1', 'acquisition 2']);
    Object.values(store.volumeInfo).forEach((info) => {
      expect(info.NumberOfSlices).toBe(3);
      expect(info.SeriesDescription).toBe('Imported series');
      expect(getDisplayName(info)).toBe(`Imported series (${info.splitLabel})`);
    });
    expect(useMessageStore().messages).toEqual([]);
  });

  it('splits a series imported one acquisition at a time, keeping the first id', () => {
    const { created, createImage } = imageFactory();
    const store = useDICOMStore();
    const first = acquisitionOne();

    const initial = store.importInstances(first, { createImage });
    const [firstId] = volumeIds(initial);
    expect(store.volumeInfo[firstId].splitLabel).toBeUndefined();

    const second = store.importInstances(acquisitionTwo(), {
      createImage,
    });

    // The pass already on screen keeps its id and gains its label; the new
    // pass gets a fresh id. Nothing dissolves.
    expect(volumeIds(second)).toContain(firstId);
    expect(volumeIds(second)).toHaveLength(2);
    expect(store.volumeInfo[firstId].splitLabel).toBe('acquisition 1');
    expect(labelsOf(store)).toEqual(['acquisition 1', 'acquisition 2']);
    expect(Object.keys(useImageCacheStore().imageById).sort()).toEqual(
      volumeIds(second)
    );
    // The first image was not rebuilt, only left holding its own pass.
    expect(created).toHaveLength(2);
    expect(created[0].getInstances()).toEqual(first);
  });

  it('keeps an established split when a later slice lacks the discriminator', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    store.importInstances([...acquisitionOne(), ...acquisitionTwo()], {
      createImage,
    });
    const untagged = sliceFor({ sop: 'untagged', z: 1.5 });
    store.importInstances([untagged], { createImage });

    // The slice no axis can place forms its own volume; the two passes stay.
    expect(labelsOf(store)).toEqual([
      'acquisition 1',
      'acquisition 2',
      'acquisition unknown',
    ]);
  });

  it('reorients a volume when a sibling pass outvotes its axes', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();
    // Within the orientation tolerance, so the passes share one set of axes.
    const tilted = '1\\0\\0\\0\\0.99995\\0.0099998';
    store.importInstances(
      [...acquisition('1', [0, 2]), ...acquisition('2', [1, 3], tilted)],
      { createImage }
    );
    const [id] = Object.entries(store.volumeInfo).find(
      ([, info]) => info.splitLabel === 'acquisition 1'
    )!;
    const directionOf = () =>
      Array.from(
        useImageCacheStore().imageById[id]!.getVtkImageData().getDirection()
      );
    const before = directionOf();

    store.importInstances(
      [
        sliceFor({
          sop: 'acq2-late',
          z: 5,
          orientation: tilted,
          tags: { [Tags.AcquisitionNumber]: '2' },
        }),
      ],
      { createImage }
    );

    expect(before).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(directionOf()[4]).toBeCloseTo(0.99995, 6);
    expect(directionOf()[5]).toBeCloseTo(0.0099998, 6);
  });

  it('warns once per volume whose repeated positions no tag separates', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();
    const doubled = () =>
      [0, 2.5, 2.5, 5].map((z, i) =>
        sliceFor({
          sop: `dup-${i}`,
          z,
          tags: { [Tags.AcquisitionNumber]: '1' },
        })
      );

    store.importInstances(doubled(), { createImage });
    // Dropping the same folder again changes nothing worth repeating.
    store.importInstances(doubled(), { createImage });

    const { messages } = useMessageStore();
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toMatch(/did not load as one sound volume/);
    expect(messages[0].options.details).toMatch(
      /^Imported series holds repeated/
    );
  });

  it('warns about each unsound volume, however alike their names', () => {
    const { createImage } = imageFactory();
    const doubled = (series: string) =>
      [0, 2.5, 2.5, 5].map((z, i) =>
        sliceFor({ sop: `${series}-${i}`, series, z })
      );

    useDICOMStore().importInstances(doubled(SERIES_UID), { createImage });
    useDICOMStore().importInstances(doubled(OTHER_SERIES_UID), {
      createImage,
    });

    const details = useMessageStore().messages.map(
      ({ options }) => options.details
    );
    expect(details).toHaveLength(2);
    expect(details[0]).toBe(details[1]);
  });

  it('warns about a volume a later import of its series leaves unsound', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();
    const unplaced = sliceFor({
      sop: 'unplaced',
      tags: { [Tags.ImagePositionPatient]: '' },
    });

    store.importInstances([unplaced], { createImage });
    expect(useMessageStore().messages).toHaveLength(0);

    store.importInstances(acquisitionOne(), { createImage });

    const details = useMessageStore().messages.map(
      ({ options }) => options.details
    );
    expect(details).toEqual([
      expect.stringMatching(
        /^Imported series \(position unknown\) holds slices whose position could not be read/
      ),
    ]);
    expect(labelsOf(store)).toEqual(['position unknown', undefined]);
  });

  it('tells the user when a later import regroups a dataset away', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();
    const tagged = (sop: string, z: number, number: string) =>
      sliceFor({ sop, z, tags: { [Tags.AcquisitionNumber]: number } });
    // Two slices of two passes load as one volume; the second batch completes
    // both passes and splits the pair so evenly that neither keeps the id.
    const first = [tagged('a', 0, '1'), tagged('b', 2, '2')];
    const second = [tagged('c', 2, '1'), tagged('d', 0, '2')];

    const [id] = volumeIds(store.importInstances(first, { createImage }));
    store.importInstances(second, { createImage });

    expect(store.volumeInfo[id]).toBeUndefined();
    const regrouped = useMessageStore().messages.filter((message) =>
      /regrouped/.test(message.title)
    );
    expect(regrouped).toHaveLength(1);
    expect(regrouped[0].options.details).toMatch(
      /^Imported series was regrouped/
    );
  });
});
