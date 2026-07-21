import {
  DataSourceType,
  Manifest,
  ManifestSchema,
  manifestDatasets,
} from '@/src/io/state-file/schema';
import {
  asErrorResult,
  ImportHandler,
  StateFileSetupResult,
} from '@/src/io/import/common';
import { MANIFEST, isStateFile } from '@/src/io/state-file/serialize';
import { partition, getURLBasename } from '@/src/utils';
import { basename } from '@/src/utils/path';
import { leafStateId } from '@/src/io/import/dataSource';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';
import type { FileEntry } from '@/src/io/types';
import { Skip } from '@/src/utils/evaluateChain';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { useMessageStore } from '@/src/store/messages';

type LeafSource =
  | { type: 'uri'; uri: string; name: string; mime?: string }
  | { type: 'file'; file: File; fileType: string };

function resolveToLeafSources(
  id: number,
  byId: Record<number, DataSourceType>,
  datasetFilePath: Record<string, string> | undefined,
  pathToFile: Record<string, File>,
  onMissingFile?: (path: string) => void
): LeafSource[] {
  const src = byId[id];
  if (!src) return [];

  switch (src.type) {
    case 'uri':
      return [
        {
          type: 'uri',
          uri: src.uri,
          name: src.name ?? getURLBasename(src.uri) ?? src.uri,
          mime: src.mime,
        },
      ];

    case 'file': {
      const filePath = datasetFilePath?.[src.fileId];
      const file = filePath ? pathToFile[filePath] : undefined;
      if (file) {
        return [{ type: 'file', file, fileType: src.fileType }];
      }
      // Recorded for the consolidated missing-content notice — the dataset's
      // SURVIVING files may still resolve it, and a partial restore must not
      // pass silently.
      onMissingFile?.(filePath ?? String(src.fileId));
      return [];
    }

    case 'archive':
      return resolveToLeafSources(
        src.parent,
        byId,
        datasetFilePath,
        pathToFile,
        onMissingFile
      );

    case 'collection':
      return src.sources.flatMap((sourceId) =>
        resolveToLeafSources(
          sourceId,
          byId,
          datasetFilePath,
          pathToFile,
          onMissingFile
        )
      );

    default:
      return [];
  }
}

const dataSourcesById = (manifest: Manifest): Record<number, DataSourceType> =>
  Object.fromEntries(manifest.dataSources.map((ds) => [ds.id, ds]));

const dataSourceDisplayNames = (
  id: number,
  byId: Record<number, DataSourceType>,
  datasetFilePath: Record<string, string> | undefined,
  visiting = new Set<number>()
): string[] => {
  if (visiting.has(id)) return [];
  const src = byId[id];
  if (!src) return [];

  const nextVisiting = new Set(visiting).add(id);
  if (src.type === 'uri') {
    return [src.name ?? getURLBasename(src.uri) ?? src.uri];
  }
  if (src.type === 'file') {
    const path = datasetFilePath?.[src.fileId];
    return path ? [basename(path)] : [];
  }
  if (src.type === 'archive') return [basename(src.path)];
  return src.sources.flatMap((sourceId) =>
    dataSourceDisplayNames(sourceId, byId, datasetFilePath, nextVisiting)
  );
};

const summarizeDataSource = (
  id: number,
  byId: Record<number, DataSourceType>,
  datasetFilePath: Record<string, string> | undefined,
  fallback: string
): string => {
  const names = [...new Set(dataSourceDisplayNames(id, byId, datasetFilePath))];
  if (names.length === 0) return fallback;
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')}, … (${names.length} files)`;
};

// A composed manifest's `datasets` covers base images only; a segment group
// wired to a uri entry via `dataSourceId` (and carrying no archive `path`)
// still needs its artifact fetched, or the group's dataIDMap key never
// materializes and restore hangs. The synthesized stateID is
// `leafStateId(dataSourceId)`, never the bare numeral: dataset ids and
// dataSourceIds are both small integers in real saves, and a shared key would
// hand the restore to leaf completion order.
const syntheticLeafSources = (manifest: Manifest): Map<number, string> => {
  const byId = dataSourcesById(manifest);
  const coveredSourceIds = new Set(
    manifestDatasets(manifest).map((ds) => ds.dataSourceId)
  );
  const referencedLeafSourceIds = new Set(
    (manifest.segmentGroups ?? [])
      .filter((sg) => sg.path === undefined && sg.dataSourceId !== undefined)
      .map((sg) => sg.dataSourceId!)
  );
  return new Map(
    [...referencedLeafSourceIds]
      .filter((id) => !coveredSourceIds.has(id) && byId[id]?.type === 'uri')
      .map((id) => [id, leafStateId(id)])
  );
};

export type ArtifactRestoreSource = {
  stateId: string;
  temporary: boolean;
};

// Each path-less segment group's artifact source: the synthesized temporary
// leaf when one was minted, else the dataset covering that source. Explicitly
// carry ownership so cleanup never removes a real dataset merely because a
// group shares its dataSourceId. Legacy manifests have no dataset/artifact
// distinction, so their path-less artifact datasets retain the consumed-temp
// behavior used before `datasets` was added.
export const resolveArtifactRestoreSources = (
  manifest: Manifest
): Record<string, ArtifactRestoreSource> => {
  const minted = syntheticLeafSources(manifest);
  const datasetIdBySourceId = new Map(
    manifestDatasets(manifest).map((ds) => [ds.dataSourceId, ds.id])
  );
  return Object.fromEntries(
    (manifest.segmentGroups ?? []).flatMap((sg) => {
      if (sg.path !== undefined || sg.dataSourceId === undefined) return [];
      const mintedStateId = minted.get(sg.dataSourceId);
      const stateId = mintedStateId ?? datasetIdBySourceId.get(sg.dataSourceId);
      return stateId !== undefined
        ? [
            [
              sg.id,
              {
                stateId,
                temporary:
                  mintedStateId !== undefined ||
                  manifest.datasets === undefined,
              },
            ] as const,
          ]
        : [];
    })
  );
};

function prepareLeafDataSources(manifest: Manifest, datasetFiles: FileEntry[]) {
  const byId = dataSourcesById(manifest);

  const pathToFile: Record<string, File> = Object.fromEntries(
    datasetFiles.map((f) => [f.archivePath, f.file])
  );

  const datasets = manifestDatasets(manifest);

  const segmentGroupLeaves = [...syntheticLeafSources(manifest).entries()].map(
    ([dataSourceId, stateId]) => ({ id: stateId, dataSourceId })
  );

  const missingFiles: Array<{ stateID: string; path: string }> = [];
  const dataSources = [...datasets, ...segmentGroupLeaves].flatMap((ds) => {
    const sources = resolveToLeafSources(
      ds.dataSourceId,
      byId,
      manifest.datasetFilePath,
      pathToFile,
      (path) => missingFiles.push({ stateID: ds.id, path })
    );

    const seen = new Set<string>();
    const uniqueSources = sources.filter((src) => {
      if (src.type !== 'uri') return true;
      if (seen.has(src.uri)) return false;
      seen.add(src.uri);
      return true;
    });

    return uniqueSources.map((src) => ({
      ...src,
      stateFileLeaf: { stateID: ds.id },
    }));
  });

  return { dataSources, missingFiles };
}

export async function completeStateFileRestore(
  manifest: Manifest,
  stateFiles: FileEntry[],
  stateIDToStoreID: Record<string, string>,
  missingFiles: Array<{ stateID: string; path: string }> = [],
  failedLeaves: Array<{ stateID: string; name: string }> = []
) {
  const viewStore = useViewStore();
  const byId = dataSourcesById(manifest);
  const datasets = manifestDatasets(manifest);
  const resolvedDatasets = datasets.filter((ds) => ds.id in stateIDToStoreID);
  const unresolvedDatasets = datasets.filter(
    (ds) => !(ds.id in stateIDToStoreID)
  );

  Object.entries(stateIDToStoreID).forEach(([stateID, storeID]) => {
    viewStore.bindViewsToData(stateID, storeID, manifest);
  });

  if (!manifest.viewByID) {
    const storeID = manifest.primarySelection
      ? stateIDToStoreID[manifest.primarySelection]
      : Object.values(stateIDToStoreID)[0];
    if (storeID) {
      viewStore.setDataForAllViews(storeID);
    }
  } else if (unresolvedDatasets.length > 0) {
    // Resolve-first-then-apply: a view whose saved dataset
    // never resolved resets to the default assignment — views are
    // reconstructible UI — rather than staying empty.
    const fallbackStoreID =
      (manifest.primarySelection
        ? stateIDToStoreID[manifest.primarySelection]
        : undefined) ??
      (resolvedDatasets.length > 0
        ? stateIDToStoreID[resolvedDatasets[0].id]
        : undefined);
    const unresolvedIDs = new Set(unresolvedDatasets.map((ds) => ds.id));
    if (fallbackStoreID !== undefined) {
      Object.entries(manifest.viewByID).forEach(([viewID, view]) => {
        if (typeof view.dataID === 'string' && unresolvedIDs.has(view.dataID)) {
          viewStore.setDataForView(viewID, fallbackStoreID);
        }
      });
    }
  }

  useViewConfigStore().deserializeAll(manifest, stateIDToStoreID);

  const segmentGroupStore = useSegmentGroupStore();
  const { segmentGroupIDMap, skipped: skippedSegmentGroups } =
    await segmentGroupStore.deserialize(
      manifest,
      stateFiles,
      stateIDToStoreID,
      resolveArtifactRestoreSources(manifest)
    );

  useLayersStore().deserialize(manifest, stateIDToStoreID);

  useToolStore().deserialize(manifest, segmentGroupIDMap, stateIDToStoreID);

  const missingBases = unresolvedDatasets.map((ds) =>
    summarizeDataSource(
      ds.dataSourceId,
      byId,
      manifest.datasetFilePath,
      String(ds.id)
    )
  );
  // Members missing from a dataset that STILL resolved (from its surviving
  // files) — an unresolved dataset is already named whole above, but a partial
  // one restores truncated and must say which files it is missing.
  const missingMembers = missingFiles
    .filter(({ stateID }) => stateID in stateIDToStoreID)
    .map(
      ({ path }) => `- file: ${basename(path)} (dataset restored without it)`
    );
  // Leaves that errored during load (e.g. a 404'd uri) while their dataset
  // still resolved from surviving leaves — an unresolved dataset is already
  // named whole in missingBases. Scoped to THIS manifest's datasets so one
  // state file's failures never appear in another's notice.
  const manifestStateIDs = new Set(datasets.map((ds) => ds.id));
  const failedMembers = [
    ...new Set(
      failedLeaves
        .filter(
          ({ stateID }) =>
            stateID in stateIDToStoreID && manifestStateIDs.has(stateID)
        )
        .map(
          ({ name }) =>
            `- file: ${name} (failed to load; dataset restored without it)`
        )
    ),
  ];
  const missing = [
    ...missingBases.map((name) => `- image: ${name}`),
    ...missingMembers,
    ...failedMembers,
    ...skippedSegmentGroups.map(
      ({ name, reason }) => `- segment group: ${name} (${reason})`
    ),
  ];
  if (missing.length > 0) {
    useMessageStore().addWarning('Some scene content could not be restored', {
      details: missing.join('\n'),
    });
  }
}

async function parseManifestFromZip(file: File) {
  const stateFileContents = await extractFilesFromZip(file);

  const [manifests, restOfStateFile] = partition(
    (dataFile) => dataFile.file.name === MANIFEST,
    stateFileContents
  );

  if (manifests.length !== 1) {
    throw new Error('State file does not have exactly 1 manifest');
  }

  const manifestString = await manifests[0].file.text();
  return { manifestString, stateFiles: restOfStateFile };
}

async function parseManifestFromJson(file: File) {
  const manifestString = await file.text();
  return { manifestString, stateFiles: [] as FileEntry[] };
}

export const restoreStateFile: ImportHandler = async (dataSource) => {
  if (dataSource.type === 'file' && (await isStateFile(dataSource.file))) {
    const isJson = dataSource.fileType === 'application/json';
    const { manifestString, stateFiles } = isJson
      ? await parseManifestFromJson(dataSource.file)
      : await parseManifestFromZip(dataSource.file);

    // Parse/validate BEFORE applying any restore: a file that fails here
    // opened nothing, so the live session must stay exactly as it was.
    const migrated = migrateManifest(manifestString);

    let manifest: Manifest;
    try {
      manifest = ManifestSchema.parse(migrated);
    } catch (e) {
      return asErrorResult(
        new Error(`Unsupported state file schema or version: ${e}`),
        dataSource
      );
    }

    useViewStore().deserializeLayout(manifest);

    const { dataSources, missingFiles } = prepareLeafDataSources(
      manifest,
      stateFiles
    );
    return {
      type: 'stateFileSetup',
      dataSources,
      manifest,
      stateFiles,
      missingFiles,
    } as StateFileSetupResult;
  }
  return Skip;
};
