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
import { pipe } from '@/src/utils/functional';
import {
  makeDefaultSegmentGroupName,
  useSegmentGroupStore,
} from '@/src/store/segmentGroups';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';
import type { FileEntry } from '@/src/io/types';
import { Skip } from '@/src/utils/evaluateChain';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';

const LABELMAP_PALETTE_2_1_0 = {
  '1': {
    value: 1,
    name: 'Segment 1',
    color: [153, 153, 0, 255],
  },
  '2': {
    value: 2,
    name: 'Segment 2',
    color: [76, 76, 0, 255],
  },
  '3': {
    value: 3,
    name: 'Segment 3',
    color: [255, 255, 0, 255],
  },
  '4': {
    value: 4,
    name: 'Segment 4',
    color: [0, 76, 0, 255],
  },
  '5': {
    value: 5,
    name: 'Segment 5',
    color: [0, 153, 0, 255],
  },
  '6': {
    value: 6,
    name: 'Segment 6',
    color: [0, 255, 0, 255],
  },
  '7': {
    value: 7,
    name: 'Segment 7',
    color: [76, 0, 0, 255],
  },
  '8': {
    value: 8,
    name: 'Segment 8',
    color: [153, 0, 0, 255],
  },
  '9': {
    value: 9,
    name: 'Segment 9',
    color: [255, 0, 0, 255],
  },
  '10': {
    value: 10,
    name: 'Segment 10',
    color: [0, 76, 76, 255],
  },
  '11': {
    value: 11,
    name: 'Segment 11',
    color: [0, 153, 153, 255],
  },
  '12': {
    value: 12,
    name: 'Segment 12',
    color: [0, 255, 255, 255],
  },
  '13': {
    value: 13,
    name: 'Segment 13',
    color: [0, 0, 76, 255],
  },
  '14': {
    value: 14,
    name: 'Segment 14',
    color: [0, 0, 153, 255],
  },
};

const migrateOrPass =
  (versions: Array<string>, migrationFunc: (manifest: any) => any) =>
  (inputManifest: any) => {
    if (versions.includes(inputManifest.version)) {
      return migrationFunc(inputManifest);
    }
    return inputManifest;
  };

const migrateBefore210 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));
  manifest.version = '2.1.0';
  return manifest;
};

const migrate210To300 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));
  manifest.tools.paint.activeSegmentGroupID =
    inputManifest.tools.paint.activeLabelmapID;
  delete manifest.tools.paint.activeLabelmapID;

  const order = Object.keys(LABELMAP_PALETTE_2_1_0).map((key) => Number(key));
  manifest.labelMaps = inputManifest.labelMaps.map(
    (labelMap: any, index: number) => ({
      id: labelMap.id,
      path: labelMap.path,
      metadata: {
        parentImage: labelMap.parent,
        name: makeDefaultSegmentGroupName('My Image', index),
        segments: {
          order,
          byValue: LABELMAP_PALETTE_2_1_0,
        },
      },
    })
  );

  manifest.version = '3.0.0';
  return manifest;
};

const migrate501To600 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  // Convert views array to viewByID object
  if (manifest.views && Array.isArray(manifest.views)) {
    manifest.viewByID = {};
    manifest.views.forEach((view: any) => {
      const migratedView = { ...view };

      // Add required 'name' field if missing
      if (!migratedView.name) {
        migratedView.name = migratedView.id;
      }

      // Convert 'props' to 'options' if present
      if (migratedView.props) {
        // Convert any non-string values in props to strings for options
        migratedView.options = {};
        Object.entries(migratedView.props).forEach(([key, value]) => {
          if (typeof value === 'string') {
            migratedView.options[key] = value;
          } else {
            // Convert arrays and objects to JSON strings
            migratedView.options[key] = JSON.stringify(value);
          }
        });
        delete migratedView.props;
      }

      // Add orientation for 2D views based on the view ID
      if (migratedView.type === '2D' && !migratedView.options) {
        migratedView.options = {};
      }
      if (migratedView.type === '2D') {
        // Set orientation based on view ID (Coronal, Sagittal, Axial)
        if (['Coronal', 'Sagittal', 'Axial'].includes(migratedView.id)) {
          migratedView.options.orientation = migratedView.id;
        }
      }

      // Handle type conversion for Oblique views
      if (migratedView.type === 'Oblique3D') {
        migratedView.type = 'Oblique';
      }

      const configKeys = Object.keys(migratedView.config || {});
      const primarySelection = manifest.primarySelection;

      migratedView.dataID = null;
      if (configKeys.length > 0) {
        migratedView.dataID =
          primarySelection && configKeys.includes(primarySelection)
            ? primarySelection
            : configKeys[0];
      }

      manifest.viewByID[migratedView.id] = migratedView;
    });
    delete manifest.views;
  }

  // Add missing fields with proper defaults
  if (manifest.isActiveViewMaximized === undefined) {
    manifest.isActiveViewMaximized = false;
  }

  if (manifest.activeView === undefined) {
    manifest.activeView = null;
  }

  // Convert layout to layoutSlots and update layout structure
  if (manifest.layout && !manifest.layoutSlots) {
    const slots: string[] = [];

    // Extract all slot names and convert layout to new format
    const convertLayoutItem = (item: any): any => {
      if (typeof item === 'string') {
        // This is a view name like "Coronal", "3D", etc.
        const slotIndex = slots.length;
        slots.push(item);
        return {
          type: 'slot',
          slotIndex,
        };
      }
      if (item.direction && item.items) {
        // This is a nested layout
        return {
          type: 'layout',
          direction: item.direction,
          items: item.items.map(convertLayoutItem),
        };
      }
      return item;
    };

    // Convert the root layout
    if (manifest.layout.direction && manifest.layout.items) {
      manifest.layout = {
        direction: manifest.layout.direction,
        items: manifest.layout.items.map(convertLayoutItem),
      };
    }

    manifest.layoutSlots = slots;
  }

  // Ensure parentToLayers exists as an array
  if (!manifest.parentToLayers) {
    manifest.parentToLayers = [];
  }

  manifest.version = '6.0.0';
  return manifest;
};

const migrate600To610 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  const migrateDirection = (dir: 'H' | 'V'): 'row' | 'column' => {
    return dir === 'H' ? 'column' : 'row';
  };

  const migrateLayout = (layout: any): any => {
    if (!layout || typeof layout !== 'object') return layout;

    const migratedLayout = { ...layout };

    if (layout.direction) {
      migratedLayout.direction = migrateDirection(layout.direction);
    }

    if (layout.items && Array.isArray(layout.items)) {
      migratedLayout.items = layout.items.map((item: any) => {
        if (item.type === 'layout') {
          return migrateLayout(item);
        }
        return item;
      });
    }

    return migratedLayout;
  };

  if (manifest.layout) {
    manifest.layout = migrateLayout(manifest.layout);
  }

  manifest.version = '6.1.0';
  return manifest;
};

const migrateManifest = (manifestString: string) => {
  const inputManifest = JSON.parse(manifestString);
  return pipe(
    inputManifest,
    migrateOrPass(['1.1.0', '1.0.0', '0.5.0'], migrateBefore210),
    migrateOrPass(['2.1.0'], migrate210To300),
    migrateOrPass(['5.0.1'], migrate501To600),
    migrateOrPass(['6.0.0'], migrate600To610)
  );
};

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
