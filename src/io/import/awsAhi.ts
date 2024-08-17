/* eslint-disable max-classes-per-file */
import { Skip } from '@/src/utils/evaluateChain';
import { asLoadableResult, ImportHandler } from '@/src/io/import/common';
import { parseUrl } from '@/src/utils/url';
import useChunkStore from '@/src/store/chunks';
import { Chunk } from '@/src/core/streaming/chunk';
import { getRequestPool } from '@/src/core/streaming/requestPool';
import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { DataLoader, Fetcher, MetaLoader } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';
import AhiChunkImage from '@/src/core/streaming/ahiChunkImage';

class AhiMetaLoader implements MetaLoader {
  private tags: Array<[string, string]>;

  constructor(frame: any) {
    this.tags = Object.entries(frame);
  }

  get meta() {
    return this.tags;
  }

  get metaBlob() {
    throw new Error('Method not implemented.');
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.tags;
    return new Blob([], { type: 'application/dicom' });
  }

  // eslint-disable-next-line class-methods-use-this, no-empty-function
  async load() {}

  // eslint-disable-next-line class-methods-use-this, no-empty-function
  stop() {}
}

class AhiDataLoader implements DataLoader {
  public data: Maybe<Blob>;
  private fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async load() {
    this.data = await this.fetcher.blob();
  }

  stop() {
    this.fetcher.close();
  }
}

const makeAhiChunk = (uri: string, frame: any) => {
  const pixelDataUri = `${uri}/${frame.ID}/pixel-data`;

  const metaLoader = new AhiMetaLoader(frame);
  const fetcher = new CachedStreamFetcher(pixelDataUri, {
    fetch: (...args) => getRequestPool().fetch(...args),
  });
  const dataLoader = new AhiDataLoader(fetcher);
  const chunk = new Chunk({
    metaLoader,
    dataLoader,
  });
  return chunk;
};

const importAhiImageSet = async (uri: string) => {
  const imageSetMetaUri = uri.replace('ahi:', 'http:');
  const setResponse = await fetch(imageSetMetaUri);
  const imageSetMeta = await setResponse.json();
  console.log(imageSetMeta);
  const patentTags = imageSetMeta.Patient.DICOM;
  const studyTags = imageSetMeta.Study.DICOM;
  const [id, firstSeries] = Object.entries(imageSetMeta.Study.Series)[0] as any;
  const seriesTags = firstSeries.DICOM;
  const frames = Object.values(firstSeries.Instances).flatMap((instance: any) =>
    instance.ImageFrames.map((frame: any) => ({
      ...patentTags,
      ...studyTags,
      ...seriesTags,
      ...instance.DICOM,
      ...frame,
    }))
  );

  const chunks = frames.map((frame: any) =>
    makeAhiChunk(imageSetMetaUri, frame)
  );

  const chunkStore = useChunkStore();
  const image = new AhiChunkImage(firstSeries);
  chunkStore.chunkImageById[id] = image;
  await image.addChunks(chunks);
  image.startLoad();

  return id;
};

export const isAhiUri = (uri: string) =>
  parseUrl(uri, window.location.origin).protocol === 'ahi:';

export const handleAhi: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'uri' || !isAhiUri(dataSource.uri)) {
    return Skip;
  }
  try {
    const id = await importAhiImageSet(dataSource.uri);

    return asLoadableResult(id, dataSource, 'image');
  } catch (err) {
    throw new Error(`Could not load AHI Image Set ${dataSource.uri}`, {
      cause: err instanceof Error ? err : undefined,
    });
  }
};
