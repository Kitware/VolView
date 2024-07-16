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
import { DataSource, ChunkDataSource } from '@/src/io/import/dataSource';
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
import { applyConfig } from '@/src/io/import/configJson';
import updateUriType from '@/src/io/import/processors/updateUriType';
import openUriStream from '@/src/io/import/processors/openUriStream';
import downloadStream from '@/src/io/import/processors/downloadStream';
import handleDicomStream from '@/src/io/import/processors/handleDicomStream';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { importDicomChunks } from '@/src/actions/importDicomChunks';
import { asyncSelect } from '@/src/utils/asyncSelect';
import { evaluateChain, Skip } from '@/src/utils/evaluateChain';
import { ensureError, partition } from '@/src/utils';
import { Chunk } from '@/src/core/streaming/chunk';
import { useDatasetStore } from '@/src/store/datasets';

const unhandledResource: ImportHandler = () => {
  throw new Error('Failed to handle resource');
};

const handleCollections: ImportHandler = (dataSource) => {
  if (!dataSource.collectionSrc) return Skip;
  return asIntermediateResult(dataSource.collectionSrc.sources);
};

function isSelectable(result: ImportResult): result is LoadableVolumeResult {
  return result.type === 'data' && result.dataType === 'image';
}

const importConfigs = (
  results: Array<ConfigResult>
): (ConfigResult | ErrorResult)[] => {
  return results.map((result) => {
    try {
      applyConfig(result.config);
      return result;
    } catch (err) {
      return asErrorResult(ensureError(err), result.dataSource);
    }
  });
};

async function importDicomChunkSources(sources: ChunkDataSource[]) {
  if (sources.length === 0) return [];

  const volumeChunks = await importDicomChunks(
    sources.map((src) => src.chunkSrc.chunk)
  );

  // this is used to reconstruct the ChunkDataSource list
  const chunkToDataSource = new Map<Chunk, ChunkDataSource>();
  sources.forEach((src) => {
    chunkToDataSource.set(src.chunkSrc.chunk, src);
  });

  return Object.entries(volumeChunks).map(([id, chunks]) =>
    asLoadableResult(
      id,
      {
        collectionSrc: {
          sources: chunks.map((chunk) => chunkToDataSource.get(chunk)!),
        },
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
    handleConfig, // collect config files to apply later
    // should be before importSingleFile, since DICOM is more specific
    handleDicomFile, // collect DICOM files to import later
    importSingleFile,
    // catch any unhandled resource
    unhandledResource,
  ];

  const chunkSources: DataSource[] = [];
  const configResults: ConfigResult[] = [];
  const results: ImportDataSourcesResult[] = [];

  let queue = [
    ...dataSources.map((src) => evaluateChain(src, handlers, importContext)),
  ];

  /* eslint-disable no-await-in-loop */
  while (queue.length) {
    const { promise, index, rest } = await asyncSelect<ImportResult>(queue);
    const result = await promise.catch((err) =>
      asErrorResult(err, dataSources[index])
    );
    queue = rest;

    switch (result.type) {
      case 'intermediate': {
        const [chunks, otherSources] = partition(
          (ds) => !!ds.chunkSrc,
          result.dataSources
        );
        chunkSources.push(...chunks);

        // try loading intermediate results
        queue.push(
          ...otherSources.map((src) =>
            evaluateChain(src, handlers, importContext)
          )
        );
        break;
      }
      case 'config':
        configResults.push(result);
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
  /* eslint-enable no-await-in-loop */

  cleanup();

  results.push(...importConfigs(configResults));

  results.push(
    ...(await importDicomChunkSources(
      chunkSources.filter(
        (src): src is ChunkDataSource =>
          src.chunkSrc?.mime === FILE_EXT_TO_MIME.dcm
      )
    ))
  );

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
