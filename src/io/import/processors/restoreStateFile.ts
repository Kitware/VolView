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
import { planLabelmapSources } from '@/src/io/import/labelmapImports';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';
import type { FileEntry } from '@/src/io/types';
import { Skip } from '@/src/utils/evaluateChain';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';
import {
  migrateManifest,
  type ManifestMigration,
} from '@/src/io/state-file/migrations';
import { useMessageStore } from '@/src/store/messages';

type LeafSource =
  | { type: 'uri'; uri: string; name: string; mime?: string }
  | { type: 'file'; file: File; fileType: string };

type LeafSourceContext = {
  byId: Record<number, DataSourceType>;
  datasetFilePath: Record<string, string> | undefined;
  pathToFile: Record<string, File>;
  onMissingFile?: (path: string) => void;
};

function resolveFileLeaf(
  src: Extract<DataSourceType, { type: 'file' }>,
  { datasetFilePath, pathToFile, onMissingFile }: LeafSourceContext
): LeafSource[] {
  const filePath = datasetFilePath?.[src.fileId];
  const file = filePath ? pathToFile[filePath] : undefined;
  if (file) {
    return [{ type: 'file', file, fileType: src.fileType }];
  }
  // Missing members must be reported even if surviving files resolve the dataset.
  onMissingFile?.(filePath ?? String(src.fileId));
  return [];
}

function resolveToLeafSources(
  id: number,
  context: LeafSourceContext
): LeafSource[] {
  const src = context.byId[id];
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

    case 'file':
      return resolveFileLeaf(src, context);

    case 'archive':
      return resolveToLeafSources(src.parent, context);

    case 'collection':
      return src.sources.flatMap((sourceId) =>
        resolveToLeafSources(sourceId, context)
      );

    default:
      return [];
  }
}

const dataSourcesById = (manifest: Manifest): Record<number, DataSourceType> =>
  Object.fromEntries(manifest.dataSources.map((ds) => [ds.id, ds]));

const leafDataSourceDisplayNames = (
  source: Exclude<DataSourceType, { type: 'collection' }>,
  datasetFilePath: Record<string, string> | undefined
) => {
  if (source.type === 'uri') {
    return [source.name ?? getURLBasename(source.uri) ?? source.uri];
  }
  if (source.type === 'file') {
    const path = datasetFilePath?.[source.fileId];
    return path ? [basename(path)] : [];
  }
  return [basename(source.path)];
};

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
  if (src.type !== 'collection') {
    return leafDataSourceDisplayNames(src, datasetFilePath);
  }
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

function prepareLeafDataSources(manifest: Manifest, datasetFiles: FileEntry[]) {
  const byId = dataSourcesById(manifest);

  const pathToFile: Record<string, File> = Object.fromEntries(
    datasetFiles.map((f) => [f.archivePath, f.file])
  );

  const datasets = manifestDatasets(manifest);

  const missingFiles: Array<{ stateID: string; path: string }> = [];
  const dataSources = [
    ...datasets,
    ...planLabelmapSources(manifest).leaves,
  ].flatMap((ds) => {
    const sources = resolveToLeafSources(ds.dataSourceId, {
      byId,
      datasetFilePath: manifest.datasetFilePath,
      pathToFile,
      onMissingFile: (path) => missingFiles.push({ stateID: ds.id, path }),
    });

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

type RestoreServices = {
  addWarning?: ReturnType<typeof useMessageStore>['addWarning'];
  views?: Pick<
    ReturnType<typeof useViewStore>,
    'bindViewsToData' | 'setDataForAllViews' | 'setDataForView'
  >;
};

export type RestoreOptions = {
  missingFiles?: Array<{ stateID: string; path: string }>;
  failedLeaves?: Array<{ stateID: string; name: string }>;
  migration?: ManifestMigration;
};

const restoreOptions = ({
  missingFiles = [],
  failedLeaves = [],
  migration,
}: RestoreOptions = {}) => ({ missingFiles, failedLeaves, migration });

export const createStateFileRestorer = ({
  addWarning = (title, options) => useMessageStore().addWarning(title, options),
  views,
}: RestoreServices = {}) =>
  async function restoreState(
    manifest: Manifest,
    stateFiles: FileEntry[],
    stateIDToStoreID: Record<string, string>,
    options?: RestoreOptions
  ) {
    const { missingFiles, failedLeaves, migration } = restoreOptions(options);
    const viewStore = views ?? useViewStore();
    const byId = dataSourcesById(manifest);
    const datasets = manifestDatasets(manifest);
    const imageName = (imageId: string) => {
      const dataset = datasets.find(({ id }) => id === imageId);
      return dataset
        ? summarizeDataSource(
            dataset.dataSourceId,
            byId,
            manifest.datasetFilePath,
            imageId
          )
        : imageId;
    };
    const resolvedDatasets = datasets.filter((ds) => ds.id in stateIDToStoreID);
    const unresolvedDatasets = datasets.filter(
      (ds) => !(ds.id in stateIDToStoreID)
    );

    // Registries first: masks and shapes name the segment identities minted here.
    const {
      segmentIdMap,
      repeated: repeatedSegments,
      unassigned,
    } = useSegmentStore().deserialize(manifest, stateIDToStoreID, migration);

    // Restore camera and contrast before asynchronous mask decoding.
    useViewConfigStore().deserializeAll(
      manifest,
      stateIDToStoreID,
      segmentIdMap
    );
    Object.entries(stateIDToStoreID).forEach(([stateID, storeID]) => {
      viewStore.bindViewsToData(stateID, storeID, manifest);
    });

    const defaultStoreID =
      (manifest.primarySelection
        ? stateIDToStoreID[manifest.primarySelection]
        : undefined) ??
      (resolvedDatasets.length > 0
        ? stateIDToStoreID[resolvedDatasets[0].id]
        : undefined);

    if (defaultStoreID !== undefined) {
      if (!manifest.viewByID) {
        viewStore.setDataForAllViews(defaultStoreID, manifest.activeView);
      } else {
        // A saved view whose image could not be restored uses the default image.
        const unresolvedIDs = new Set(unresolvedDatasets.map((ds) => ds.id));
        Object.entries(manifest.viewByID).forEach(([viewID, view]) => {
          if (
            typeof view.dataID === 'string' &&
            unresolvedIDs.has(view.dataID)
          ) {
            viewStore.setDataForView(viewID, defaultStoreID);
          }
        });
      }
    }

    const { skipped: skippedLabelmaps } =
      await useSegmentationStore().deserialize({
        manifest,
        stateFiles,
        dataIDMap: stateIDToStoreID,
        segmentIdMap,
        labelmapSources: planLabelmapSources(manifest).sources,
      });

    useLayersStore().deserialize(manifest, stateIDToStoreID);

    const skippedTools = useToolStore().deserialize(
      manifest,
      segmentIdMap,
      stateIDToStoreID
    );

    const missingBases = unresolvedDatasets.map(({ id }) => imageName(id));
    // Partially restored datasets need member notices; unresolved datasets are named above.
    const missingMembers = missingFiles
      .filter(({ stateID }) => stateID in stateIDToStoreID)
      .map(
        ({ path }) => `- file: ${basename(path)} (dataset restored without it)`
      );
    // Report failed members only for surviving datasets in this manifest.
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
      ...skippedLabelmaps.map(
        ({ name, reason }) => `- labelmap: ${name} (${reason})`
      ),
      ...skippedTools.map(
        ({ name, reason }) => `- annotation: ${name} (${reason})`
      ),
      // A migrated catalog repeats each bad row on every image it was copied to.
      ...[...new Set(repeatedSegments.map(({ name }) => name))].map(
        (name) => `- segment: ${name} (repeats the id of an earlier segment)`
      ),
      ...unassigned.map(
        ({ name }) => `- segment: ${name} (is not assigned to an image)`
      ),
    ];
    if (missing.length > 0) {
      addWarning('Some scene content could not be restored', {
        details: missing.join('\n'),
      });
    }
  };

export const completeStateFileRestore = createStateFileRestorer();

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
    let manifest: Manifest;
    let migration: ManifestMigration;
    try {
      const migrated = migrateManifest(manifestString);
      manifest = ManifestSchema.parse(migrated.manifest);
      migration = migrated.migration;
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
      migration,
      stateFiles,
      missingFiles,
    } as StateFileSetupResult;
  }
  return Skip;
};
