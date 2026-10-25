import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Chunk } from '@/src/core/streaming/chunk';
import { Tags } from '@/src/core/dicomTags';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { uriToDataSource, type DataSource } from '@/src/io/import/dataSource';
import type { ChunkSource } from '@/src/io/import/dataSource';
import { importDicomChunkSources } from '@/src/io/import/importDataSources';
import { useDatasetStore } from '@/src/store/datasets';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import {
  getDisplayName,
  useDICOMStore,
  type ImportChunksResult,
} from '@/src/store/datasets-dicom';
import {
  chunkFor,
  imageFactory,
  sopOf,
} from '@/src/store/__tests__/dicomImportFixtures';

// Slices of one acquisition, interleaved with a second acquisition's slices
// along the same stretch of the slice axis.
const acquisition = (number: string, zs: number[]) =>
  zs.map((z, i) =>
    chunkFor({
      sop: `acq${number}-${i}`,
      z,
      tags: { [Tags.AcquisitionNumber]: number },
    })
  );

const acquisitionOne = () => acquisition('1', [0, 2.5, 5]);
const acquisitionTwo = () => acquisition('2', [0.75, 3.25, 5.75]);

const volumeIds = (result: ImportChunksResult) =>
  Object.keys(result.volumes).sort();

const labelsOf = (store: ReturnType<typeof useDICOMStore>) =>
  Object.values(store.volumeInfo)
    .map((info) => info.splitLabel)
    .sort();

const chunkSource = (chunk: Chunk) => {
  const source: DataSource = {
    type: 'chunk',
    chunk,
    mime: FILE_EXT_TO_MIME.dcm,
    parent: uriToDataSource(
      `https://example.test/${sopOf(chunk)}.dcm`,
      `${sopOf(chunk)}.dcm`,
      FILE_EXT_TO_MIME.dcm
    ),
  };
  return source as DataSource & ChunkSource;
};

const sopsOf = (source: DataSource | undefined) => {
  if (source?.type !== 'collection') throw new Error('Expected collection');
  return source.sources.map((member) => {
    if (member.type !== 'chunk') throw new Error('Expected a chunk source');
    return sopOf(member.chunk);
  });
};

describe('DICOM store acquisition split across imports', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('loads one series holding two overlapping passes as two labelled volumes', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();

    const result = await store.importChunks(
      [...acquisitionOne(), ...acquisitionTwo()],
      { createChunkImage }
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

  it('splits a series imported one acquisition at a time, keeping the first id', async () => {
    const { created, createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const first = acquisitionOne();

    const initial = await store.importChunks(first, { createChunkImage });
    const [firstId] = volumeIds(initial);
    expect(store.volumeInfo[firstId].splitLabel).toBeUndefined();

    const second = await store.importChunks(acquisitionTwo(), {
      createChunkImage,
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
    expect(created[0].getChunks()).toEqual(first);
  });

  it('does not duplicate a subset re-imported after the full series', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();

    await store.importChunks([...acquisitionOne(), ...acquisitionTwo()], {
      createChunkImage,
    });
    const again = await store.importChunks(acquisitionOne(), {
      createChunkImage,
    });

    expect(Object.keys(store.volumeInfo)).toHaveLength(2);
    expect(again.dissolved).toEqual([]);
    Object.values(again.volumes).forEach((members) => {
      expect(members).toHaveLength(3);
    });
  });

  it('keeps an established split when a later slice lacks the discriminator', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();

    await store.importChunks([...acquisitionOne(), ...acquisitionTwo()], {
      createChunkImage,
    });
    const untagged = chunkFor({ sop: 'untagged', z: 1.5 });
    const result = await store.importChunks([untagged], { createChunkImage });

    // The slice no axis can place forms its own volume; the two passes stay.
    expect(result.dissolved).toEqual([]);
    expect(labelsOf(store)).toEqual([
      'acquisition 1',
      'acquisition 2',
      'acquisition unknown',
    ]);
  });

  it('warns once per volume whose repeated positions no tag separates', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const doubled = () =>
      [0, 2.5, 2.5, 5].map((z, i) =>
        chunkFor({
          sop: `dup-${i}`,
          z,
          tags: { [Tags.AcquisitionNumber]: '1' },
        })
      );

    await store.importChunks(doubled(), { createChunkImage });
    // Dropping the same folder again changes nothing worth repeating.
    await store.importChunks(doubled(), { createChunkImage });

    const { messages } = useMessageStore();
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toMatch(/did not load as one sound volume/);
    expect(messages[0].options.details).toMatch(
      /^Imported series holds repeated/
    );
  });

  it('tells the user when a later import regroups a dataset away', async () => {
    const { createChunkImage } = imageFactory();
    const store = useDICOMStore();
    const tagged = (sop: string, z: number, number: string) =>
      chunkFor({ sop, z, tags: { [Tags.AcquisitionNumber]: number } });
    // Two slices of two passes load as one volume; the second batch completes
    // both passes and splits the pair so evenly that neither keeps the id.
    const first = [tagged('a', 0, '1'), tagged('b', 2, '2')];
    const second = [tagged('c', 2, '1'), tagged('d', 0, '2')];

    const [id] = volumeIds(
      await store.importChunks(first, { createChunkImage })
    );
    const result = await store.importChunks(second, { createChunkImage });

    expect(result.dissolved).toEqual([id]);
    const regrouped = useMessageStore().messages.filter((message) =>
      /regrouped/.test(message.title)
    );
    expect(regrouped).toHaveLength(1);
    expect(regrouped[0].options.details).toMatch(
      /^Imported series was regrouped/
    );
  });

  it('repartitions saved provenance when a later import splits the series', async () => {
    const { createChunkImage } = imageFactory();
    const datasetStore = useDatasetStore();
    const store = useDICOMStore();
    const first = acquisitionOne().map(chunkSource);
    const second = acquisitionTwo().map(chunkSource);
    const load = async (sources: ChunkSource[]) => {
      const loadables = await importDicomChunkSources(
        sources,
        (chunks, hooks) =>
          store.importChunks(chunks, { createChunkImage, ...hooks })
      );
      return loadables.map(({ dataID }) => dataID);
    };

    const [firstId] = await load(first);
    const ids = await load(second);
    const secondId = ids.find((id) => id !== firstId)!;

    // Each dataset saves exactly its own pass, so a restore replans them the
    // same way and binds saved state to the right volume.
    expect(sopsOf(datasetStore.getDataSource(firstId))).toEqual(
      first.map((src) => sopOf(src.chunk))
    );
    expect(sopsOf(datasetStore.getDataSource(secondId))).toEqual(
      second.map((src) => sopOf(src.chunk))
    );
  });
});
