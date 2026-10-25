import {
  ImportHandler,
  ImportResult,
  asErrorResult,
  asLoadableResult,
  asOkayResult,
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
import handleDicom from '@/src/io/import/processors/handleDicom';
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
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { asyncSelect } from '@/src/utils/asyncSelect';
import { evaluateChain, Skip } from '@/src/utils/evaluateChain';
import { ensureError, partition } from '@/src/utils';
import { Chunk } from '@/src/core/streaming/chunk';
import { useDatasetStore } from '@/src/store/datasets';
import {
  PartialImportError,
  useDICOMStore,
  type ImportChunksDeps,
  type ImportChunksResult,
} from '@/src/store/datasets-dicom';
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
// A dataset whose leaves now load as SEVERAL volumes (a series since split
// into acquisitions) has no single owner for its saved state; it is left
// unmapped so restore reports it instead of binding annotations, layers, and
// views to an arbitrary one of the volumes.
export function buildStateIDToStoreID(
  loadables: readonly LoadableResult[]
): Record<string, string> {
  return Object.fromEntries(
    [...storeIDsByStateID(loadables)]
      .filter(([, storeIDs]) => storeIDs.size === 1)
      .map(([stateID, storeIDs]) => [stateID, [...storeIDs][0]])
  );
}

/**
 * The state-file datasets the map above leaves out because their leaves now
 * load as several volumes, with those volumes. The restore names them as
 * split rather than as missing: every one of them is on screen.
 */
export function findSplitStateDatasets(
  loadables: readonly LoadableResult[]
): Record<string, string[]> {
  return Object.fromEntries(
    [...storeIDsByStateID(loadables)]
      .filter(([, storeIDs]) => storeIDs.size > 1)
      .map(([stateID, storeIDs]) => [stateID, [...storeIDs]])
  );
}

function storeIDsByStateID(loadables: readonly LoadableResult[]) {
  const storeIDsByState = new Map<string, Set<string>>();
  loadables.forEach((loadable) => {
    findStateFileLeaves(loadable.dataSource).forEach((leaf) => {
      const storeIDs = storeIDsByState.get(leaf.stateID) ?? new Set();
      storeIDs.add(loadable.dataID);
      storeIDsByState.set(leaf.stateID, storeIDs);
    });
  });
  return storeIDsByState;
}

// A chunk outlives the batch that brought it: a replan can move a member into
// another collection, whose provenance must still name where that byte came
// from. Weak keys let a released chunk take its entry with it.
const chunkToDataSource = new WeakMap<Chunk, ChunkSource>();

/**
 * A DICOM import where at least one series failed. The loadables the series
 * that did commit produced ride along, because their datasets exist whether or
 * not a sibling series threw.
 */
export class PartialDicomImportError extends Error {
  readonly loadables: LoadableResult[];

  // Only the sources of the series that failed, so a committed series is not
  // reported as loaded and failed at once.
  readonly failedSources: ChunkSource[];

  constructor(
    cause: Error,
    loadables: LoadableResult[],
    failedSources: ChunkSource[]
  ) {
    super(cause.message);
    this.name = 'PartialDicomImportError';
    this.cause = cause;
    this.loadables = loadables;
    this.failedSources = failedSources;
  }
}

/**
 * A committed series becomes datasets here, inside the transaction that
 * committed it: publishing after the whole batch settled would let a series a
 * slow sibling delayed overwrite the membership a later import had recorded.
 */
const publishImportedChunks = ({ volumes }: ImportChunksResult) => {
  const datasetStore = useDatasetStore();

  // Every member reports back, so a collection that gained a member from a
  // dissolved one carries its provenance too.
  const loadables = Object.entries(volumes).map(([id, chunks]) =>
    asLoadableResult(
      id,
      {
        type: 'collection',
        sources: chunks
          .map((chunk) => chunkToDataSource.get(chunk))
          .filter((src): src is ChunkSource => src !== undefined),
      },
      'image'
    )
  );
  datasetStore.addDataSources(loadables);
  // These name what this batch supplied, not what the merged dataset now holds;
  // the store owns that. Callers may read a name off them, never persist one.
  return loadables;
};

/** What the import needs of its caller: where to publish and how to remove. */
export type ImportChunksHooks = Required<
  Pick<ImportChunksDeps, 'onCommitted' | 'removeDissolved'>
>;

export async function importDicomChunkSources(
  sources: ChunkSource[],
  importChunks = (chunks: Chunk[], hooks: ImportChunksHooks) =>
    useDICOMStore().importChunks(chunks, hooks)
) {
  if (sources.length === 0) return [];

  sources.forEach((src) => chunkToDataSource.set(src.chunk, src));

  const loadables: LoadableResult[] = [];
  const publish = (committed: ImportChunksResult) => {
    loadables.push(...publishImportedChunks(committed));
  };
  // A replan folded the dissolved collection into others, so the dataset an
  // earlier import created for it no longer describes anything loaded. The
  // dataset store's removal clears every store that names it, in the order
  // eviction needs.
  const datasetStore = useDatasetStore();
  const removeDissolved = (id: string) => datasetStore.remove(id);

  await importChunks(
    sources.map((src) => src.chunk),
    {
      onCommitted: publish,
      removeDissolved,
    }
  ).catch((err) => {
    if (!(err instanceof PartialImportError)) throw err;
    // The series that committed published themselves, so they are reported
    // beside the failure rather than lost with it.
    throw new PartialDicomImportError(
      ensureError(err.cause),
      loadables,
      err.failed
        .map((chunk) => chunkToDataSource.get(chunk))
        .filter((src): src is ChunkSource => src !== undefined)
    );
  });

  return loadables;
}

/**
 * Imports a drained queue's DICOM chunks. The series that committed are loaded,
 * so their datasets are reported beside a failure rather than lost with it, and
 * only the sources of the series that failed are blamed for it.
 */
async function importDicomResults(
  sources: ChunkSource[]
): Promise<ImportDataSourcesResult[]> {
  try {
    return await importDicomChunkSources(sources);
  } catch (err) {
    const partial = err instanceof PartialDicomImportError ? err : null;
    const failed = partial?.failedSources.length
      ? partial.failedSources
      : sources;
    const errorSource =
      failed.length === 1
        ? failed[0]
        : ({ type: 'collection', sources: failed } as DataSource);
    return [
      ...(partial?.loadables ?? []),
      asErrorResult(ensureError(err), errorSource),
    ];
  }
}

type ImportPolicy = 'application' | 'volume-data';

/**
 * The two halves of a state-file restore: the handler that reads the manifest
 * out of the pipeline, and the step that applies it once the bases have
 * loaded.
 */
export type RestoreProcessors = {
  restoreStateFile: typeof restoreStateFile;
  completeStateFileRestore: typeof completeStateFileRestore;
};

export const appRestoreProcessors = (): RestoreProcessors => ({
  restoreStateFile,
  completeStateFileRestore,
});

async function importDataSourcesWithPolicy(
  dataSources: DataSource[],
  policy: ImportPolicy,
  restore: RestoreProcessors = appRestoreProcessors()
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
    importDataSources: (sources: DataSource[]) =>
      importDataSourcesWithPolicy(sources, policy, restore),
  };

  // State files first: a manifest's top-level `segments` is also a config key.
  const applicationHandlers =
    policy === 'application'
      ? [restore.restoreStateFile, handleConfig, handleRemoteManifest]
      : [];

  const handlers = [
    handleCollections,

    openUriStream,

    // updating the file/uri type should be first step in the pipeline
    updateFileMimeType,
    updateUriType,
    // before extractArchive as .zip extension is part of state file check
    ...applicationHandlers,
    handleGoogleCloudStorage,
    handleAmazonS3,

    // stream handling
    // before downloadStream and extractArchive: a DICOM source reads its own
    // header, whether it is a file or a uri
    handleDicom,
    downloadStream,

    extractArchive,
    extractArchiveTarget,
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

  const dicomChunkSources = chunkSources.filter(
    (src): src is ChunkSource =>
      src.type === 'chunk' && src.mime === FILE_EXT_TO_MIME.dcm
  );

  const dicomResults = await importDicomResults(dicomChunkSources);
  results.push(...dicomResults);

  const loadableResults = results.filter(
    (r): r is LoadableResult => r.type === 'data'
  );

  // A DICOM dataset was published inside its series transaction, so adding it
  // again here would restore the membership that import saw rather than the
  // membership the series now holds.
  const published = new Set<ImportDataSourcesResult>(dicomResults);
  useDatasetStore().addDataSources(
    loadableResults.filter((result) => !published.has(result))
  );

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
  const splitDatasets = findSplitStateDatasets(loadableResults);
  // Leaf stateIDs covered by a consolidated notice that actually ran — only
  // their errors may be suppressed below.
  const reportedStateIDs = new Set<string>();
  for (const setup of stateFileSetups) {
    try {
      await restore.completeStateFileRestore(
        setup.manifest,
        setup.stateFiles,
        stateIDToStoreID,
        setup.missingFiles,
        failedLeaves,
        splitDatasets
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

  results.push(...applyConfigsPostState(configResults));

  // A failed state-file leaf is already counted in the restore's consolidated
  // missing-content notice, so this layer owns its reporting: it returns as an
  // accounted-for 'ok' result, never as an error. An 'error' result in the
  // return value therefore ALWAYS means "not yet surfaced to the user" —
  // callers own reporting exactly the errors they receive, and no failure is
  // reported twice.
  return results.map((result) => {
    if (result.type !== 'error') return result;
    const leaves = findStateFileLeaves(result.dataSource);
    const covered =
      leaves.length > 0 &&
      leaves.every((leaf) => reportedStateIDs.has(leaf.stateID));
    return covered ? asOkayResult(result.dataSource) : result;
  });
}

export function importDataSources(
  dataSources: DataSource[],
  restore: RestoreProcessors = appRestoreProcessors()
): Promise<ImportDataSourcesResult[]> {
  return importDataSourcesWithPolicy(dataSources, 'application', restore);
}

export function importVolumeDataSources(
  dataSources: DataSource[]
): Promise<ImportDataSourcesResult[]> {
  return importDataSourcesWithPolicy(dataSources, 'volume-data');
}

export function toDataSelection(loadable: LoadableVolumeResult) {
  const { dataID } = loadable;
  return dataID;
}

export function convertSuccessResultToDataSelection(result: ImportResult) {
  if (!isSelectable(result)) return null;
  return toDataSelection(result);
}
