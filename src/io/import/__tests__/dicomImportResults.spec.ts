import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  buildStateIDToStoreID,
  importDicomInstanceSources,
  PartialDicomImportError,
} from '@/src/io/import/importDataSources';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useDatasetStore } from '@/src/store/datasets';
import type {
  DicomInstanceSource,
  DataSource,
} from '@/src/io/import/dataSource';
import {
  imageFactory,
  sopOf,
  unallocatableFor,
} from '@/src/store/__tests__/dicomImportFixtures';

const source = (
  sop: string,
  stateID = sop,
  series?: string
): DicomInstanceSource & DataSource => ({
  type: 'dicom',
  instance: unallocatableFor({ sop, series }),
  stateFileLeaf: { stateID },
});

beforeEach(() => setActivePinia(createPinia()));

it('returns a stable order regardless of series commit order', () => {
  const sources = [source('a'), source('b')];
  const loadables = importDicomInstanceSources(sources, () => ({
    volumes: { b: [sources[1].instance], a: [sources[0].instance] },
    dissolved: [],
  }));
  expect(loadables.map(({ dataID }) => dataID)).toEqual(['a', 'b']);
});

it('maps only leaves supplied by this restore while saving full membership', () => {
  const previous = source('previous', '1');
  importDicomInstanceSources([previous], (instances) => ({
    volumes: { existing: instances },
    dissolved: [],
  }));
  const current = source('current', '2');
  const other = source('other', '1');
  const loadables = importDicomInstanceSources([current, other], () => ({
    volumes: {
      existing: [previous.instance, current.instance],
      other: [other.instance],
    },
    dissolved: [],
  }));
  expect(buildStateIDToStoreID(loadables)).toEqual({
    1: 'other',
    2: 'existing',
  });
  const saved = useDatasetStore().getDataSource('existing');
  expect(saved?.type === 'collection' && saved.sources).toEqual([
    previous,
    current,
  ]);
});

it('preserves the failure of every rejected series and blames its own sources', () => {
  const first = source('first');
  const second = source('second', 'second', '2');
  const { createImage } = imageFactory();
  const failure = (() => {
    try {
      importDicomInstanceSources([first, second], (instances, hooks) =>
        useDICOMStore().importInstances(instances, { ...hooks, createImage })
      );
      return null;
    } catch (error) {
      return error;
    }
  })();
  if (!(failure instanceof PartialDicomImportError))
    throw new Error('Expected failed import');
  expect(
    failure.failures.map(({ error, sources }) => [
      error.message,
      sources.map(({ instance }) => sopOf(instance)),
    ])
  ).toEqual([
    [expect.stringMatching(/rescale range/), ['first']],
    [expect.stringMatching(/rescale range/), ['second']],
  ]);
});
