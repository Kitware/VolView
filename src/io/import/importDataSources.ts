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
  StateFileSetupResult,
} from '@/src/io/import/common';
import {
  DataSource,
  ChunkSource,
  findStateFileLeaves,
  getDataSourceName,
} from '@/src/io/import/dataSource';
import handleDicomFile from '@/src/io/import/processors/handleDicomFile';
import extractArchive from '@/src/io/import/processors/extractArchive';
import extractArchiveTarget from '@/src/io/import/processors/extractArchiveTarget';
import handleAmazonS3 from '@/src/io/import/processors/handleAmazonS3';
import handleGoogleCloudStorage from '@/src/io/import/processors/handleGoogleCloudStorage';
import importSingleFile from '@/src/io/import/processors/importSingleFile';
import handleRemoteManifest from '@/src/io/import/processors/remoteManifest';
import {
  restoreStateFile,
  completeStateFileRestore,
} from '@/src/io/import/processors/restoreStateFile';
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
import { useMessageStore } from '@/src/store/messages';

const unhandledResource: ImportHandler = (dataSource) => {
  return asErrorResult(new Error('Failed to handle resource'), dataSource);
};

const handleCollections: ImportHandler = (dataSource) => {
  if (dataSource.type !== 'collection') return Skip;
  // Propagate stateFileLeaf to sources so DICOM volumes can be mapped back to state file datasets
  const sources = dataSource.stateFileLeaf
    ? dataSource.sources.map((src) => ({
        ...src,
        stateFileLeaf: dataSource.stateFileLeaf,
      }))
    : dataSource.sources;
  return asIntermediateResult(sources);
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

// The restore-time stateID -> storeID map: every state-file leaf a loadable
// covers maps to its ONE store id. Many-to-one is the normal shape — a merged
// multi-file DICOM volume covers every member file's per-file dataset id.
export function buildStateIDToStoreID(
  loadables: readonly LoadableResult[]
): Record<string, string> {
  const stateIDToStoreID: Record<string, string> = {};
  loadables.forEach((loadable) => {
    findStateFileLeaves(loadable.dataSource).forEach((leaf) => {
      stateIDToStoreID[leaf.stateID] = loadable.dataID;
    });
  });
  return stateIDToStoreID;
}

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
  const stateFileSetups: StateFileSetupResult[] = [];
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
      case 'stateFileSetup':
        stateFileSetups.push(result);
      // fallthrough to handle dataSources
      case 'intermediate': {
        const [chunks, otherSources] = partition(
          (ds) => ds.type === 'chunk',
          result.dataSources
        );
        chunkSources.push(...chunks);

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
          await applyPreStateConfig(result.config);
        } catch (err) {
          results.push(asErrorResult(ensureError(err), result.dataSource));
        }
        break;
      case 'ok':
      case 'error':
      case 'data':
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
    const dicomResults = await importDicomChunkSources(dicomChunkSources);
    results.push(...dicomResults);
  } catch (err) {
    const errorSource =
      dicomChunkSources.length === 1
        ? dicomChunkSources[0]
        : ({ type: 'collection', sources: dicomChunkSources } as DataSource);
    results.push(asErrorResult(ensureError(err), errorSource));
  }

  const loadableResults = results.filter(
    (r): r is LoadableResult => r.type === 'data'
  );

  useDatasetStore().addDataSources(loadableResults);

  // Failed leaves (e.g. a 404'd uri member of a multi-leaf dataset) feed the
  // restore's consolidated notice: a dataset that still resolves from its
  // surviving leaves restores truncated and must say which sources failed.
  const failedLeaves = results
    .filter((r): r is ErrorResult => r.type === 'error')
    .flatMap((r) =>
      findStateFileLeaves(r.dataSource).map((leaf) => ({
        stateID: leaf.stateID,
        name: getDataSourceName(r.dataSource) ?? leaf.stateID,
      }))
    );

  const stateIDToStoreID = buildStateIDToStoreID(loadableResults);
  // Leaf stateIDs covered by a consolidated notice that actually ran — only
  // their errors may be suppressed below.
  const reportedStateIDs = new Set<string>();
  for (const setup of stateFileSetups) {
    try {
      await completeStateFileRestore(
        setup.manifest,
        setup.stateFiles,
        stateIDToStoreID,
        setup.missingFiles,
        failedLeaves
      );
      setup.dataSources.forEach((src) => {
        findStateFileLeaves(src).forEach((leaf) =>
          reportedStateIDs.add(leaf.stateID)
        );
      });
      setup.missingFiles.forEach(({ stateID }) =>
        reportedStateIDs.add(stateID)
      );
    } catch (err) {
      // Auto-degrade to an ephemeral open: a mid-restore throw leaves the
      // already-loaded bases as plain datasets and the session's attached set
      // stays empty, so a later save prunes every launch-composition entry.
      // Restore steps already applied (layout, view bindings) are not rolled
      // back. One notice here; this setup's leaf errors stay unflagged so the
      // generic load-error dialog still names them.
      useMessageStore().addWarning(
        'Could not restore the saved session; opened its images instead',
        { details: ensureError(err).message }
      );
    }
  }

  // A failed state-file leaf is already counted in the restore's consolidated
  // missing-content notice, so flag it — a caller surfacing errors must not
  // raise a second, generic notice for the same leaf.
  return results.map((result) => {
    if (result.type !== 'error') return result;
    const leaves = findStateFileLeaves(result.dataSource);
    const covered =
      leaves.length > 0 &&
      leaves.every((leaf) => reportedStateIDs.has(leaf.stateID));
    return covered ? { ...result, alreadyReported: true } : result;
  });
}

export function toDataSelection(loadable: LoadableVolumeResult) {
  const { dataID } = loadable;
  return dataID;
}

export function convertSuccessResultToDataSelection(result: ImportResult) {
  if (!isSelectable(result)) return null;
  return toDataSelection(result);
}
