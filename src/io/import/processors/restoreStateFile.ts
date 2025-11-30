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
import { DataSource } from '@/src/io/import/dataSource';
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

function findRootUriAncestors(
  id: number,
  byId: Record<string, DataSourceType>
): DataSourceType[] {
  const src = byId[id];
  if (!src) return [];
  if (src.type === 'uri') return [src];
  if ('parent' in src && src.parent !== undefined) {
    return findRootUriAncestors(src.parent, byId);
  }
  if (src.type === 'collection') {
    const uris = new Map<number, DataSourceType>();
    src.sources.forEach((sourceId) => {
      findRootUriAncestors(sourceId, byId).forEach((uri) => {
        uris.set(uri.id, uri);
      });
    });
    return [...uris.values()];
  }
  return [];
}

function rebuildDataSources(
  serializedDataSources: DataSourceType[],
  fileIDToFile: Record<number, File>
) {
  const dataSourceCache: Record<string, DataSource> = {};
  const byId: Record<string, DataSourceType> = {};
  const leaves = new Set<number>();

  serializedDataSources.forEach((serializedSrc) => {
    byId[serializedSrc.id] = serializedSrc;
    leaves.add(serializedSrc.id);
  });

  const deserialize = (
    serialized: (typeof serializedDataSources)[number]
  ): DataSource | null => {
    const { type } = serialized;
    switch (type) {
      case 'file':
        return {
          type: 'file',
          file: fileIDToFile[serialized.fileId],
          fileType: serialized.fileType,
        };
      case 'archive': {
        const parent = dataSourceCache[serialized.parent];
        if (!parent) {
          return null;
        }
        if (parent.type !== 'file') {
          return null;
        }
        return {
          type: 'archive',
          path: serialized.path,
          parent,
        };
      }
      case 'uri': {
        const defaultName = getURLBasename(serialized.uri) || serialized.uri;
        return {
          type: 'uri',
          uri: serialized.uri,
          name: serialized.name ?? defaultName,
          mime: serialized.mime,
        };
      }
      case 'collection': {
        serialized.sources.forEach((id) => {
          leaves.delete(id);
        });
        const sources = serialized.sources
          .map((id) => dataSourceCache[id])
          .filter((src): src is DataSource => src != null);
        if (sources.length === 0) {
          return null;
        }
        return {
          type: 'collection',
          sources,
        };
      }
      default:
        throw new Error(
          `Encountered an invalid serialized data source: ${type}`
        );
    }
  };

  for (let i = 0; i < serializedDataSources.length; i++) {
    const serializedSrc = serializedDataSources[i];

    if (serializedSrc.id in dataSourceCache) {
      continue;
    }

    const dataSource = deserialize(serializedSrc);

    if (!dataSource) {
      const rootUris = findRootUriAncestors(serializedSrc.id, byId);
      leaves.delete(serializedSrc.id);
      rootUris.forEach((uri) => leaves.add(uri.id));
      continue;
    }

    if (serializedSrc.parent) {
      dataSource.parent = dataSourceCache[serializedSrc.parent];
      leaves.delete(serializedSrc.parent);
    }

    dataSourceCache[serializedSrc.id] = dataSource;
  }

  return { dataSourceCache, leaves, byId };
}

function prepareLeafDataSources(manifest: Manifest, datasetFiles: FileEntry[]) {
  const { dataSources } = manifest;
  const datasets =
    manifest.datasets ??
    dataSources
      .filter((ds) => ds.type === 'uri')
      .map((ds) => ({ id: String(ds.id), dataSourceId: ds.id }));
  const datasetFilePath = manifest.datasetFilePath ?? {};

  const dataSourceIDToStateID = datasets.reduce<Record<number, string>>(
    (acc, ds) =>
      Object.assign(acc, {
        [ds.dataSourceId]: ds.id,
      }),
    {}
  );
  const pathToFile = datasetFiles.reduce<Record<string, File>>(
    (acc, datasetFile) =>
      Object.assign(acc, {
        [datasetFile.archivePath]: datasetFile.file,
      }),
    {}
  );
  const fileIDToFile = Object.entries(datasetFilePath).reduce<
    Record<number, File>
  >(
    (acc, [fileId, filePath]) =>
      Object.assign(acc, {
        [fileId]: pathToFile[filePath],
      }),
    {}
  );

  const { dataSourceCache, leaves, byId } = rebuildDataSources(
    dataSources,
    fileIDToFile
  );

  const leafDataSources = [...leaves]
    .filter((leafId) => leafId in dataSourceCache)
    .map((leafId) => {
      const dataSource = dataSourceCache[leafId];

      let stateID = dataSourceIDToStateID[leafId];

      if (!stateID) {
        const matchingDataset = datasets.find((ds) => {
          const rootUris = findRootUriAncestors(ds.dataSourceId, byId);
          return rootUris.some((uri) => uri.id === leafId);
        });
        if (matchingDataset) {
          stateID = matchingDataset.id;
        }
      }

      return {
        ...dataSource,
        stateFileLeaf: { stateID },
      };
    });

  return leafDataSources;
}

async function completeStateFileRestore(ctx: StateFileContext) {
  const { manifest, stateFiles, stateIDToStoreID } = ctx;
  const stateIDToStoreIDRecord = Object.fromEntries(stateIDToStoreID);

  // Restore view configs (handles missing configs gracefully)
  useViewConfigStore().deserializeAll(manifest, stateIDToStoreIDRecord);

  // Restore the labelmaps
  const segmentGroupIDMap = await useSegmentGroupStore().deserialize(
    manifest,
    stateFiles,
    stateIDToStoreIDRecord
  );

  // Restore the tools (each tool handles missing data gracefully)
  useToolStore().deserialize(
    manifest,
    segmentGroupIDMap,
    stateIDToStoreIDRecord
  );

  useLayersStore().deserialize(manifest, stateIDToStoreIDRecord);
}

const restoreStateFile: ImportHandler = async (dataSource, context) => {
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

export default restoreStateFile;
