import {
  ImportHandler,
  type ImportContext,
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
  DicomInstanceSource,
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
import { asyncSelect } from '@/src/utils/asyncSelect';
import { evaluateChain, Skip } from '@/src/utils/evaluateChain';
import { ensureError } from '@/src/utils';
import type { Instance } from '@/packages/dicom/core';
import { useDatasetStore } from '@/src/store/datasets';
import {
  PartialImportError,
  useDICOMStore,
  type ImportInstancesDeps,
  type ImportInstancesResult,
} from '@/src/store/datasets-dicom';
import { useMessageStore } from '@/src/store/messages';
import { shouldSkipImportSource } from '@/src/io/import/shouldSkipImportSource';

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

const compareSourceOrder = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
};

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

// An instance outlives the batch that brought it: a replan can move a member
// into another collection, whose provenance must still name where its bytes
// came from.
const instanceToDataSource = new WeakMap<Instance, DicomInstanceSource>();

const sourcesOf = (instances: Instance[]) =>
  instances
    .map((instance) => instanceToDataSource.get(instance))
    .filter((src): src is DicomInstanceSource => src !== undefined);

/**
 * A DICOM import where at least one series failed. The loadables the series
 * that did commit produced ride along, because their datasets exist whether or
 * not a sibling series threw.
 */
export class PartialDicomImportError extends Error {
  readonly loadables: LoadableResult[];

  readonly failures: { error: Error; sources: DicomInstanceSource[] }[];

  constructor(
    loadables: LoadableResult[],
    failures: { error: Error; sources: DicomInstanceSource[] }[]
  ) {
    super(failures[0].error.message);
    this.name = 'PartialDicomImportError';
    this.cause = failures[0].error;
    this.loadables = loadables;
    this.failures = failures;
  }
}

/** What the import needs of its caller: how to remove a dissolved dataset. */
export type ImportInstancesHooks = Required<
  Pick<ImportInstancesDeps, 'removeDissolved'>
>;

const loadableOf = (id: string, sources: DicomInstanceSource[]) =>
  asLoadableResult(id, { type: 'collection', sources }, 'image');

export function importDicomInstanceSources(
  sources: DicomInstanceSource[],
  importInstances = (instances: Instance[], hooks: ImportInstancesHooks) =>
    useDICOMStore().importInstances(instances, hooks)
) {
  if (sources.length === 0) return [];

  sources.forEach((src) => instanceToDataSource.set(src.instance, src));

  const supplied = new Set<DataSource>(sources);
  const datasetStore = useDatasetStore();
  // Every member reports back, so a collection that gained a member from a
  // dissolved one saves its provenance too; the result names only this
  // import's own sources.
  const publish = ({ volumes }: ImportInstancesResult) => {
    const entries = Object.entries(volumes);
    datasetStore.addDataSources(
      entries.map(([id, instances]) => loadableOf(id, sourcesOf(instances)))
    );
    return entries
      .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
      .map(([id, instances]) =>
        loadableOf(
          id,
          sourcesOf(instances).filter((source) => supplied.has(source))
        )
      );
  };
  // The dataset store's removal clears every store that names a dissolved
  // dataset, in the order eviction needs.
  const hooks = { removeDissolved: (id: string) => datasetStore.remove(id) };

  try {
    return publish(
      importInstances(
        sources.map((src) => src.instance),
        hooks
      )
    );
  } catch (err) {
    if (!(err instanceof PartialImportError)) throw err;
    // The series that committed are reported beside the failure.
    throw new PartialDicomImportError(
      publish(err.committed),
      err.failures.map(({ error, instances }) => ({
        error,
        sources: sourcesOf(instances),
      }))
    );
  }
}

/**
 * Imports a drained queue's DICOM instances. The series that committed are
 * loaded, so their datasets are reported beside a failure rather than lost
 * with it, and only the sources of the series that failed are blamed for it.
 */
function importDicomResults(
  sources: DicomInstanceSource[]
): ImportDataSourcesResult[] {
  try {
    return importDicomInstanceSources(sources);
  } catch (err) {
    const partial = err instanceof PartialDicomImportError ? err : null;
    const failures = partial?.failures ?? [
      { error: ensureError(err), sources },
    ];
    return [
      ...(partial?.loadables ?? []),
      ...failures.map(({ error, sources: failed }) =>
        asErrorResult(
          error,
          failed.length === 1
            ? failed[0]
            : { type: 'collection', sources: failed.length ? failed : sources }
        )
      ),
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

async function processImportQueue(
  dataSources: DataSource[],
  handlers: ImportHandler[],
  importContext: ImportContext
) {
  const instanceSources: Array<{ source: DataSource; order: number[] }> = [];
  const configResults: ConfigResult[] = [];
  const stateFileSetups: StateFileSetupResult[] = [];
  const results: ImportDataSourcesResult[] = [];

  const queuedSource = (src: DataSource, order: number[]) => ({
    promise: evaluateChain(src, handlers, importContext),
    source: src,
    order,
  });
  const enqueue = (sources: DataSource[]) =>
    sources
      .filter((src) => !shouldSkipImportSource(src))
      .map((src, index) => queuedSource(src, [index]));

  let queue = enqueue(dataSources);

  while (queue.length) {
    const { index } = await asyncSelect(queue.map((item) => item.promise));
    const { promise, source, order } = queue[index];
    const result = await promise.catch((err) => asErrorResult(err, source));
    queue = queue.filter((_, i) => i !== index);

    switch (result.type) {
      case 'stateFileSetup':
        stateFileSetups.push(result);
      // fallthrough to handle dataSources
      case 'intermediate': {
        result.dataSources.forEach((src, childIndex) => {
          if (shouldSkipImportSource(src)) return;
          const childOrder = [...order, childIndex];
          if (src.type === 'dicom')
            instanceSources.push({ source: src, order: childOrder });
          else queue.push(queuedSource(src, childOrder));
        });
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

  return { instanceSources, configResults, stateFileSetups, results };
}

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

  const importContext: ImportContext = {
    fetchFileCache: new Map(),
    archiveCache: new Map(),
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

  const { instanceSources, configResults, stateFileSetups, results } =
    await processImportQueue(dataSources, handlers, importContext);

  cleanup();

  const dicomInstanceSources = instanceSources
    .sort((a, b) => compareSourceOrder(a.order, b.order))
    .map(({ source }) => source)
    .filter((src): src is DicomInstanceSource => src.type === 'dicom');

  const dicomResults = importDicomResults(dicomInstanceSources);
  results.push(...dicomResults);

  const loadableResults = results.filter(
    (r): r is LoadableResult => r.type === 'data'
  );

  // A DICOM dataset was published with its series commit, so adding it
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
