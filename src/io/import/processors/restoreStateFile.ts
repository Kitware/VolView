import {
  DataSourceType,
  Manifest,
  ManifestSchema,
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
  pathToFile: Record<string, File>
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
      // A missing archive file surfaces through the consolidated
      // missing-content notice (the dataset never resolves), not a
      // per-file error here.
      return [];
    }

    case 'archive':
      return resolveToLeafSources(
        src.parent,
        byId,
        datasetFilePath,
        pathToFile
      );

    case 'collection':
      return src.sources.flatMap((sourceId) =>
        resolveToLeafSources(sourceId, byId, datasetFilePath, pathToFile)
      );

    default:
      return [];
  }
}

const dataSourcesById = (manifest: Manifest): Record<number, DataSourceType> =>
  Object.fromEntries(manifest.dataSources.map((ds) => [ds.id, ds]));

// The manifest's base datasets; older manifests carry no `datasets`, so every
// uri source stands in for one (same fallback the leaf preparation fetches).
const manifestDatasets = (manifest: Manifest) =>
  manifest.datasets ??
  manifest.dataSources
    .filter((ds) => ds.type === 'uri')
    .map((ds) => ({ id: String(ds.id), dataSourceId: ds.id }));

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

  return [...datasets, ...segmentGroupLeaves].flatMap((ds) => {
    const sources = resolveToLeafSources(
      ds.dataSourceId,
      byId,
      manifest.datasetFilePath,
      pathToFile
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
}

export async function completeStateFileRestore(
  manifest: Manifest,
  stateFiles: FileEntry[],
  stateIDToStoreID: Record<string, string>
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
  const missing = [
    ...missingBases.map((name) => `- image: ${name}`),
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

    return {
      type: 'stateFileSetup',
      dataSources: prepareLeafDataSources(manifest, stateFiles),
      manifest,
      stateFiles,
    } as StateFileSetupResult;
  }
  return Skip;
};
