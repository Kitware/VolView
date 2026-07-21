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

function prepareLeafDataSources(manifest: Manifest, datasetFiles: FileEntry[]) {
  const byId = dataSourcesById(manifest);

  const pathToFile: Record<string, File> = Object.fromEntries(
    datasetFiles.map((f) => [f.archivePath, f.file])
  );

  const datasets = manifestDatasets(manifest);

  // A composed manifest's `datasets` covers base images only; a segment group
  // wired to a uri entry via `dataSourceId` (and carrying no archive `path`)
  // still needs its artifact fetched, or the group's dataIDMap key never
  // materializes and restore hangs. Synthesize dataset entries for exactly
  // those referenced uri sources — never for unreferenced uri entries, and
  // never when the group's bytes ride in the zip under `path`. The synthesized
  // stateID is `leafStateId(dataSourceId)`, never the bare numeral: dataset
  // ids and dataSourceIds are both small integers in real saves, and a shared
  // key would hand the restore to leaf completion order.
  const coveredSourceIds = new Set(datasets.map((ds) => ds.dataSourceId));
  const referencedLeafSourceIds = new Set(
    (manifest.segmentGroups ?? [])
      .filter((sg) => sg.path === undefined && sg.dataSourceId !== undefined)
      .map((sg) => sg.dataSourceId!)
  );
  const segmentGroupLeaves = [...referencedLeafSourceIds]
    .filter((id) => !coveredSourceIds.has(id) && byId[id]?.type === 'uri')
    .map((id) => ({ id: leafStateId(id), dataSourceId: id }));

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
    await segmentGroupStore.deserialize(manifest, stateFiles, stateIDToStoreID);

  useLayersStore().deserialize(manifest, stateIDToStoreID);

  useToolStore().deserialize(manifest, segmentGroupIDMap, stateIDToStoreID);

  // ONE consolidated missing-content notice: unresolved bases plus
  // skipped segment groups, aggregated — never a per-item error loop.
  const missingBases = unresolvedDatasets.map((ds) => {
    const src = byId[ds.dataSourceId];
    if (src?.type === 'uri') return src.name ?? src.uri;
    // File/archive bases have a recorded filename too — name them by it rather
    // than a bare numeric dataset id, preserving the diagnosability the removed
    // per-file error carried.
    if (src?.type === 'file') {
      const path = manifest.datasetFilePath?.[src.fileId];
      if (path) return basename(path);
    }
    if (src?.type === 'archive') return basename(src.path);
    return String(ds.id);
  });
  // Segment-group skips carry a concrete reason from deserialize (parent image
  // did not load / artifact source unavailable / could not read labelmap) so the
  // notice tells the user WHY each segmentation was left out, not just that it
  // was.
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
