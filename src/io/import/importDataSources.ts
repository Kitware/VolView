import {
  ImportHandler,
  ImportResult,
  asErrorResult,
  asLoadableResult,
  ConfigResult,
  LoadableVolumeResult,
  LoadableResult,
  ErrorResult,
  ImportDataSourcesResult,
  asIntermediateResult,
} from '@/src/io/import/common';
import { DataSource, ChunkSource } from '@/src/io/import/dataSource';
import handleDicomFile from '@/src/io/import/processors/handleDicomFile';
import extractArchive from '@/src/io/import/processors/extractArchive';
import extractArchiveTarget from '@/src/io/import/processors/extractArchiveTarget';
import handleAmazonS3 from '@/src/io/import/processors/handleAmazonS3';
import handleGoogleCloudStorage from '@/src/io/import/processors/handleGoogleCloudStorage';
import importSingleFile from '@/src/io/import/processors/importSingleFile';
import handleRemoteManifest from '@/src/io/import/processors/remoteManifest';
import restoreStateFile from '@/src/io/import/processors/restoreStateFile';
import updateFileMimeType from '@/src/io/import/processors/updateFileMimeType';
import handleConfig from '@/src/io/import/processors/handleConfig';
import {
  applyPreStateConfig,
  applyPostStateConfig,
} from '@/src/io/import/configJson';
import updateUriType from '@/src/io/import/processors/updateUriType';
import openUriStream from '@/src/io/import/processors/openUriStream';
import downloadStream from '@/src/io/import/processors/downloadStream';
import handleDicomStream from '@/src/io/import/processors/handleDicomStream';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { asyncSelect } from '@/src/utils/asyncSelect';
import { evaluateChain, Skip } from '@/src/utils/evaluateChain';
import { ensureError, partition } from '@/src/utils';
import { Chunk } from '@/src/core/streaming/chunk';
import { useDatasetStore } from '@/src/store/datasets';
import { useDICOMStore } from '@/src/store/datasets-dicom';

const unhandledResource: ImportHandler = (dataSource) => {
  return asErrorResult(new Error('Failed to handle resource'), dataSource);
};

const handleCollections: ImportHandler = (dataSource) => {
  if (dataSource.type !== 'collection') return Skip;
  return asIntermediateResult(dataSource.sources);
};

function isSelectable(result: ImportResult): result is LoadableVolumeResult {
  return result.type === 'data' && result.dataType === 'image';
}

const applyConfigsPostState = (
  results: Array<ConfigResult>
): (ConfigResult | ErrorResult)[] =>
  results.map((result) => {
    try {
      applyPostStateConfig(result.config);
      return result;
    } catch (err) {
      return asErrorResult(ensureError(err), result.dataSource);
    }
  });

async function importDicomChunkSources(sources: ChunkSource[]) {
  if (sources.length === 0) return [];

  const volumeChunks = await useDICOMStore().importChunks(
    sources.map((src) => src.chunk)
  );

  // this is used to reconstruct the ChunkSource list
  const chunkToDataSource = new Map<Chunk, ChunkSource>();
  sources.forEach((src) => {
    chunkToDataSource.set(src.chunk, src);
  });

  return Object.entries(volumeChunks).map(([id, chunks]) =>
    asLoadableResult(
      id,
      {
        type: 'collection',
        sources: chunks.map((chunk) => chunkToDataSource.get(chunk)!),
      },
      'image'
    )
  );
}

export async function importDataSources(
  dataSources: DataSource[]
): Promise<ImportDataSourcesResult[]> {
  const cleanupHandlers: Array<() => void> = [];
  const onCleanup = (fn: () => void) => {
    cleanupHandlers.push(fn);
  };
  const cleanup = () => {
    while (cleanupHandlers.length) cleanupHandlers.pop()!();
  };

  const importContext = {
    fetchFileCache: new Map<string, File>(),
    onCleanup,
    importDataSources,
  };

  const handlers = [
    handleCollections,

    openUriStream,

    // updating the file/uri type should be first step in the pipeline
    updateFileMimeType,
    updateUriType,
    handleConfig,

    // before extractArchive as .zip extension is part of state file check
    restoreStateFile,
    handleRemoteManifest,
    handleGoogleCloudStorage,
    handleAmazonS3,

    // stream handling
    handleDicomStream,
    downloadStream,

    extractArchive,
    extractArchiveTarget,
    // should be before importSingleFile, since DICOM is more specific
    handleDicomFile, // collect DICOM files to import later
    importSingleFile,
    // catch any unhandled resource
    unhandledResource,
  ];

  const chunkSources: DataSource[] = [];
  const configResults: ConfigResult[] = [];
  const results: ImportDataSourcesResult[] = [];

  let queue = dataSources.map((src) => ({
    promise: evaluateChain(src, handlers, importContext),
    source: src,
  }));

  while (queue.length) {
    const { index } = await asyncSelect(queue.map((item) => item.promise));
    const { promise, source } = queue[index];
    const result = await promise.catch((err) => asErrorResult(err, source));
    queue = queue.filter((_, i) => i !== index);

    switch (result.type) {
      case 'intermediate': {
        const [chunks, otherSources] = partition(
          (ds) => ds.type === 'chunk',
          result.dataSources
        );
        chunkSources.push(...chunks);

        // try loading intermediate results
        queue.push(
          ...otherSources.map((src) => ({
            promise: evaluateChain(src, handlers, importContext),
            source: src,
          }))
        );
        break;
      }
      case 'config':
        configResults.push(result);
        try {
          applyPreStateConfig(result.config);
        } catch (err) {
          results.push(asErrorResult(ensureError(err), result.dataSource));
        }
        break;
      case 'ok':
      case 'data':
      case 'error':
        results.push(result);
        break;
      default:
        throw new Error(`Invalid result: ${result}`);
    }
  }

  cleanup();

  results.push(...applyConfigsPostState(configResults));

  const dicomChunkSources = chunkSources.filter(
    (src): src is ChunkSource =>
      src.type === 'chunk' && src.mime === FILE_EXT_TO_MIME.dcm
  );

  try {
    results.push(...(await importDicomChunkSources(dicomChunkSources)));
  } catch (err) {
    const errorSource =
      dicomChunkSources.length === 1
        ? dicomChunkSources[0]
        : ({ type: 'collection', sources: dicomChunkSources } as DataSource);
    results.push(asErrorResult(ensureError(err), errorSource));
  }

  // save data sources
  useDatasetStore().addDataSources(
    results.filter((result): result is LoadableResult => result.type === 'data')
  );

  return results;
}

export function toDataSelection(loadable: LoadableVolumeResult) {
  const { dataID } = loadable;
  return dataID;
}

export function convertSuccessResultToDataSelection(result: ImportResult) {
  if (!isSelectable(result)) return null;
  return toDataSelection(result);
}
