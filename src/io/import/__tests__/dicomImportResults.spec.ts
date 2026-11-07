import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  buildStateIDToStoreID,
  importDicomChunkSources,
  PartialDicomImportError,
} from '@/src/io/import/importDataSources';
import { PartialImportError, useDICOMStore } from '@/src/store/datasets-dicom';
import { useDatasetStore } from '@/src/store/datasets';
import type { ChunkSource, DataSource } from '@/src/io/import/dataSource';
import {
  chunkFor,
  imageFactory,
  sopOf,
} from '@/src/store/__tests__/dicomImportFixtures';

const source = (sop: string, stateID = sop): ChunkSource & DataSource => ({
  type: 'chunk',
  chunk: chunkFor({ sop }),
  mime: 'application/dicom',
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
  const loadables = await importDicomChunkSources(
    sources,
    async (_, { onCommitted }) => {
      const result = { volumes: {}, dissolved: [] };
      onCommitted({ ...result, volumes: { b: [sources[1].chunk] } });
      onCommitted({ ...result, volumes: { a: [sources[0].chunk] } });
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
    const delayed = importDicomChunkSources(
      [first],
      async (_, { onCommitted }) => {
        const result = { volumes: { old: [first.chunk] }, dissolved: [] };
        onCommitted(result);
        committed.resolve();
        await finish.promise;
        if (fail) throw new PartialImportError(new Error('failed'), []);
        return result;
      }
    ).catch((error: PartialDicomImportError) => error.loadables);
    await committed.promise;
    await importDicomChunkSources([source('second')], async (chunks, hooks) => {
      const result = { volumes: { current: chunks }, dissolved: ['old'] };
      hooks.removeDissolved('old');
      hooks.onCommitted(result);
      return result;
    });
    finish.resolve();
    expect(await delayed).toEqual([]);
  }
);

it('maps only leaves supplied by this restore while saving full membership', async () => {
  const previous = source('previous', '1');
  await importDicomChunkSources([previous], async (chunks, { onCommitted }) => {
    const result = { volumes: { existing: chunks }, dissolved: [] };
    onCommitted(result);
    return result;
  });
  const current = source('current', '2');
  const other = source('other', '1');
  const loadables = await importDicomChunkSources(
    [current, other],
    async (_, { onCommitted }) => {
      const result = {
        volumes: {
          existing: [previous.chunk, current.chunk],
          other: [other.chunk],
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

it('preserves a distinct failure reason for every rejected series', async () => {
  const first = source('first');
  const second = {
    ...source('second'),
    chunk: chunkFor({ sop: 'second', series: '2' }),
  };
  const { createChunkImage } = imageFactory({
    onPrepare: async (_, chunks) => {
      throw new Error(`Cannot allocate ${sopOf(chunks[0])}`);
    },
  });
  const failure = await importDicomChunkSources(
    [first, second],
    (chunks, hooks) =>
      useDICOMStore().importChunks(chunks, { ...hooks, createChunkImage })
  ).catch((error: PartialDicomImportError) => error);
  expect(failure).toBeInstanceOf(PartialDicomImportError);
  if (!(failure instanceof PartialDicomImportError))
    throw new Error('Expected failed import');
  expect(
    failure.failures.map(({ error, sources }) => [
      error.message,
      sources.map(({ chunk }) => sopOf(chunk)),
    ])
  ).toEqual([
    ['Cannot allocate first', ['first']],
    ['Cannot allocate second', ['second']],
  ]);
});
