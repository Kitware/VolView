import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { Tags, type Instance } from '@/packages/dicom/core';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { uriToDataSource, type DataSource } from '@/src/io/import/dataSource';
import type { DicomInstanceSource } from '@/src/io/import/dataSource';
import { importDicomInstanceSources } from '@/src/io/import/importDataSources';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import {
  getDisplayName,
  useDICOMStore,
  type ImportInstancesResult,
} from '@/src/store/datasets-dicom';
import {
  imageFactory,
  sliceFor,
  sopOf,
} from '@/src/store/__tests__/dicomImportFixtures';

// Slices of one acquisition, interleaved with a second acquisition's slices
// along the same stretch of the slice axis.
const acquisition = (number: string, zs: number[], orientation?: string) =>
  zs.map((z, i) =>
    sliceFor({
      sop: `acq${number}-${i}`,
      z,
      orientation,
      tags: { [Tags.AcquisitionNumber]: number },
    })
  );

const acquisitionOne = () => acquisition('1', [0, 2.5, 5]);
const acquisitionTwo = () => acquisition('2', [0.75, 3.25, 5.75]);

const volumeIds = (result: ImportInstancesResult) =>
  Object.keys(result.volumes).sort();

const labelsOf = (store: ReturnType<typeof useDICOMStore>) =>
  Object.values(store.volumeInfo)
    .map((info) => info.splitLabel)
    .sort();

const instanceSource = (instance: Instance) => {
  const source: DataSource = {
    type: 'dicom',
    instance,
    parent: uriToDataSource(
      `https://example.test/${sopOf(instance)}.dcm`,
      `${sopOf(instance)}.dcm`,
      FILE_EXT_TO_MIME.dcm
    ),
  };
  return source as DataSource & DicomInstanceSource;
};

const sopsOf = (source: DataSource | undefined) => {
  if (source?.type !== 'collection') throw new Error('Expected collection');
  return source.sources.map((member) => {
    if (member.type !== 'dicom') throw new Error('Expected a DICOM source');
    return sopOf(member.instance);
  });
};

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
    expect(second.dissolved).toEqual([]);
    expect(store.volumeInfo[firstId].splitLabel).toBe('acquisition 1');
    expect(labelsOf(store)).toEqual(['acquisition 1', 'acquisition 2']);
    expect(Object.keys(useImageCacheStore().imageById).sort()).toEqual(
      volumeIds(second)
    );
    // The first image was not rebuilt, only left holding its own pass.
    expect(created).toHaveLength(2);
    expect(created[0].getInstances()).toEqual(first);
  });

  it('does not duplicate a subset re-imported after the full series', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    store.importInstances([...acquisitionOne(), ...acquisitionTwo()], {
      createImage,
    });
    const again = store.importInstances(acquisitionOne(), {
      createImage,
    });

    expect(Object.keys(store.volumeInfo)).toHaveLength(2);
    expect(again.dissolved).toEqual([]);
    Object.values(again.volumes).forEach((members) => {
      expect(members).toHaveLength(3);
    });
  });

  it('keeps an established split when a later slice lacks the discriminator', () => {
    const { createImage } = imageFactory();
    const store = useDICOMStore();

    store.importInstances([...acquisitionOne(), ...acquisitionTwo()], {
      createImage,
    });
    const untagged = sliceFor({ sop: 'untagged', z: 1.5 });
    const result = store.importInstances([untagged], { createImage });

    // The slice no axis can place forms its own volume; the two passes stay.
    expect(result.dissolved).toEqual([]);
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
    const result = store.importInstances(second, { createImage });

    expect(result.dissolved).toEqual([id]);
    const regrouped = useMessageStore().messages.filter((message) =>
      /regrouped/.test(message.title)
    );
    expect(regrouped).toHaveLength(1);
    expect(regrouped[0].options.details).toMatch(
      /^Imported series was regrouped/
    );
  });

  it('repartitions saved provenance when a later import splits the series', () => {
    const { createImage } = imageFactory();
    const datasetStore = useDatasetStore();
    const store = useDICOMStore();
    const first = acquisitionOne().map(instanceSource);
    const second = acquisitionTwo().map(instanceSource);
    const load = (sources: DicomInstanceSource[]) => {
      const loadables = importDicomInstanceSources(
        sources,
        (instances, hooks) =>
          store.importInstances(instances, { createImage, ...hooks })
      );
      return loadables.map(({ dataID }) => dataID);
    };

    const [firstId] = load(first);
    const ids = load(second);
    const secondId = ids.find((id) => id !== firstId)!;

    // Each dataset saves exactly its own pass, so a restore replans them the
    // same way and binds saved state to the right volume.
    expect(sopsOf(datasetStore.getDataSource(firstId))).toEqual(
      first.map((src) => sopOf(src.instance))
    );
    expect(sopsOf(datasetStore.getDataSource(secondId))).toEqual(
      second.map((src) => sopOf(src.instance))
    );
  });
});
