import {
  DataSourceType,
  Manifest,
  ManifestSchema,
} from '@/src/io/state-file/schema';
import {
  asErrorResult,
  asIntermediateResult,
  ImportHandler,
  StateFileContext,
} from '@/src/io/import/common';
import { MANIFEST, isStateFile } from '@/src/io/state-file';
import { partition, getURLBasename } from '@/src/utils';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';
import type { FileEntry } from '@/src/io/types';
import { Skip } from '@/src/utils/evaluateChain';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';
import { migrateManifest } from '@/src/io/state-file/migrations';

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
      console.warn(
        `State file missing expected file: ${filePath ?? src.fileId}`
      );
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

function prepareLeafDataSources(manifest: Manifest, datasetFiles: FileEntry[]) {
  const byId: Record<number, DataSourceType> = Object.fromEntries(
    manifest.dataSources.map((ds) => [ds.id, ds])
  );

  const pathToFile: Record<string, File> = Object.fromEntries(
    datasetFiles.map((f) => [f.archivePath, f.file])
  );

  const datasets =
    manifest.datasets ??
    manifest.dataSources
      .filter((ds) => ds.type === 'uri')
      .map((ds) => ({ id: String(ds.id), dataSourceId: ds.id }));

  return datasets.flatMap((ds) => {
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

async function completeStateFileRestore(ctx: StateFileContext) {
  const { manifest, stateFiles, stateIDToStoreID } = ctx;
  const stateIDToStoreIDRecord = Object.fromEntries(stateIDToStoreID);

  useViewConfigStore().deserializeAll(manifest, stateIDToStoreIDRecord);

  const segmentGroupIDMap = await useSegmentGroupStore().deserialize(
    manifest,
    stateFiles,
    stateIDToStoreIDRecord
  );
  useLayersStore().deserialize(manifest, stateIDToStoreIDRecord);

  useToolStore().deserialize(
    manifest,
    segmentGroupIDMap,
    stateIDToStoreIDRecord
  );
}

export const restoreStateFile: ImportHandler = async (dataSource, context) => {
  if (dataSource.type === 'file' && (await isStateFile(dataSource.file))) {
    const stateFileContents = await extractFilesFromZip(dataSource.file);

    const [manifests, restOfStateFile] = partition(
      (dataFile) => dataFile.file.name === MANIFEST,
      stateFileContents
    );

    if (manifests.length !== 1) {
      throw new Error('State file does not have exactly 1 manifest');
    }

    const manifestString = await manifests[0].file.text();
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

    // Phase 1: Set up view layout immediately (without data bindings)
    const viewStore = useViewStore();
    viewStore.deserializeLayout(manifest);

    // Prepare leaf data sources with state file tags
    const leafDataSources = prepareLeafDataSources(manifest, restOfStateFile);

    if (leafDataSources.length === 0) {
      // No datasets to import, complete restoration immediately
      await completeStateFileRestore({
        manifest,
        stateFiles: restOfStateFile,
        stateIDToStoreID: new Map(),
        pendingLeafCount: 0,
        onLeafImported: () => {},
        onAllLeavesImported: async () => {},
      });

      // When viewByID is not in manifest, there's no data to assign
      return asIntermediateResult([]);
    }

    // Set up state file context for phase 2 and 3 callbacks
    const stateFileContext: StateFileContext = {
      manifest,
      stateFiles: restOfStateFile,
      stateIDToStoreID: new Map(),
      pendingLeafCount: leafDataSources.length,
      onLeafImported: (stateID: string, storeID: string) => {
        // Phase 2: Bind view to data as each leaf completes
        viewStore.bindViewsToData(stateID, storeID, manifest);
      },
      onAllLeavesImported: async () => {
        // Phase 3: Restore segment groups, tools, layers after all data loaded
        await completeStateFileRestore(stateFileContext);

        // When viewByID is not in manifest, assign first dataset to all views
        if (!manifest.viewByID) {
          const firstStoreID = stateFileContext.stateIDToStoreID
            .values()
            .next().value;
          if (firstStoreID) {
            viewStore.setDataForAllViews(firstStoreID);
          }
        }
      },
    };

    // Store context for use by main pipeline
    if (context) {
      context.stateFileContext = stateFileContext;
    }

    // Return leaf data sources to be processed by main pipeline
    return asIntermediateResult(leafDataSources);
  }
  return Skip;
};
