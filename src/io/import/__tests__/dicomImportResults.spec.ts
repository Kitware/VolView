import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  buildStateIDToStoreID,
  importDicomInstanceSources,
  PartialDicomImportError,
} from '@/src/io/import/importDataSources';
import { PartialImportError, useDICOMStore } from '@/src/store/datasets-dicom';
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => setActivePinia(createPinia()));

it('returns a stable order regardless of series commit order', async () => {
  const sources = [source('a'), source('b')];
  const loadables = await importDicomInstanceSources(
    sources,
    async (_, { onCommitted }) => {
      const result = { volumes: {}, dissolved: [] };
      onCommitted({ ...result, volumes: { b: [sources[1].instance] } });
      onCommitted({ ...result, volumes: { a: [sources[0].instance] } });
      return result;
    }
  );
  expect(loadables.map(({ dataID }) => dataID)).toEqual(['a', 'b']);
});

it.each([false, true])(
  'omits a dissolved volume when an overlapping import overtakes it (failure=%s)',
  async (fail) => {
    const first = source('first');
    const committed = deferred();
    const finish = deferred();
    const delayed = importDicomInstanceSources(
      [first],
      async (_, { onCommitted }) => {
        const result = { volumes: { old: [first.instance] }, dissolved: [] };
        onCommitted(result);
        committed.resolve();
        await finish.promise;
        if (fail)
          throw new PartialImportError([
            { error: new Error('failed'), instances: [] },
          ]);
        return result;
      }
    ).catch((error: PartialDicomImportError) => error.loadables);
    await committed.promise;
    await importDicomInstanceSources(
      [source('second')],
      async (instances, hooks) => {
        const result = { volumes: { current: instances }, dissolved: ['old'] };
        hooks.removeDissolved('old');
        hooks.onCommitted(result);
        return result;
      }
    );
    finish.resolve();
    expect(await delayed).toEqual([]);
  }
);

it('maps only leaves supplied by this restore while saving full membership', async () => {
  const previous = source('previous', '1');
  await importDicomInstanceSources(
    [previous],
    async (instances, { onCommitted }) => {
      const result = { volumes: { existing: instances }, dissolved: [] };
      onCommitted(result);
      return result;
    }
  );
  const current = source('current', '2');
  const other = source('other', '1');
  const loadables = await importDicomInstanceSources(
    [current, other],
    async (_, { onCommitted }) => {
      const result = {
        volumes: {
          existing: [previous.instance, current.instance],
          other: [other.instance],
        },
        dissolved: [],
      };
      onCommitted(result);
      return result;
    }
  );
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

it('preserves the failure of every rejected series and blames its own sources', async () => {
  const first = source('first');
  const second = source('second', 'second', '2');
  const { createImage } = imageFactory();
  const failure = await importDicomInstanceSources(
    [first, second],
    (instances, hooks) =>
      useDICOMStore().importInstances(instances, { ...hooks, createImage })
  ).catch((error: PartialDicomImportError) => error);
  expect(failure).toBeInstanceOf(PartialDicomImportError);
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
