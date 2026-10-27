import { blobFetcher } from '../streaming/blobFetcher';
import { CachedStreamFetcher } from '../streaming/cachedStreamFetcher';
import { Chunk } from '../streaming/chunk';
import { DicomDataLoader } from '../streaming/dicom/dicomDataLoader';
import { DicomMetaLoader } from '../streaming/dicom/dicomMetaLoader';
import { RequestPool } from '../streaming/requestPool';
import type { Fetcher } from '../streaming/types';
import {
  createMetadataReader,
  type MetadataReaderOptions,
} from './metadataReader';
import {
  createDicomDecoder,
  type DicomAssets,
  type DicomDecoder,
} from './decoder';

export type DicomLoaderOptions = MetadataReaderOptions & {
  fetch?: typeof fetch;
  requestConcurrency?: number;
  assets?: DicomAssets;
  /** A supplied decoder owns its own resources. Returned pixel arrays belong to the caller. */
  decoder?: DicomDecoder;
  imageImportPolicy?: 'complete-header' | 'skip-radiotherapy';
};

/** Owns sources, requests and workers; images borrow chunks and copy decoded pixels. */
export function createDicomLoader(options: DicomLoaderOptions = {}) {
  const requests = new RequestPool(options.requestConcurrency, options.fetch);
  const metadata = createMetadataReader(options);
  const decoder =
    options.assets && !options.decoder
      ? createDicomDecoder(options.assets, metadata.read)
      : null;
  const chunks = new Set<Chunk>();
  const sources = new WeakSet<Fetcher>();
  const pending = new Set<(reason: unknown) => void>();
  let disposed = false;
  const assertActive = () => {
    if (disposed) throw new DOMException('DICOM loader disposed', 'AbortError');
  };
  const createChunk = (source: Blob | string | URL | Fetcher) => {
    assertActive();
    let fetcher: Fetcher;
    if (source instanceof Blob) fetcher = blobFetcher(source);
    else if (typeof source === 'string' || source instanceof URL)
      fetcher = new CachedStreamFetcher(source, { fetch: requests.fetch });
    else fetcher = source;
    if (sources.has(fetcher))
      throw new Error('A DICOM byte source already belongs to a live chunk');
    sources.add(fetcher);
    const chunk = new Chunk({
      metaLoader: new DicomMetaLoader(
        fetcher,
        metadata.read,
        options.imageImportPolicy
      ),
      dataLoader: new DicomDataLoader(fetcher),
      onDispose: () => {
        chunks.delete(chunk);
        sources.delete(fetcher);
      },
    });
    chunks.add(chunk);
    return chunk;
  };
  const readDicomImage: DicomDecoder = (file, header) =>
    new Promise((resolve, reject) => {
      try {
        assertActive();
      } catch (error) {
        reject(error);
        return;
      }
      const decode = options.decoder ?? decoder?.decode;
      if (!decode) {
        reject(new Error('Provide DICOM decoder assets or a decoder'));
        return;
      }
      pending.add(reject);
      Promise.resolve()
        .then(() => decode(file, header))
        .then((result) => {
          assertActive();
          resolve(result);
        }, reject)
        .catch(reject)
        .finally(() => pending.delete(reject));
    });
  const release = (chunk: Chunk) => {
    if (chunks.has(chunk)) chunk.dispose();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    chunks.forEach((chunk) => chunk.dispose());
    chunks.clear();
    requests.dispose();
    metadata.dispose();
    decoder?.dispose();
    pending.forEach((reject) =>
      reject(new DOMException('DICOM loader disposed', 'AbortError'))
    );
    pending.clear();
  };
  return {
    createChunk,
    readDicomImage,
    release,
    dispose,
    fetch: requests.fetch,
  };
}
export type DicomLoader = ReturnType<typeof createDicomLoader>;
