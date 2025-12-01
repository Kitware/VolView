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
      const missingFile = filePath ?? String(src.fileId);
      useMessageStore().addError(
        'State file missing expected file',
        missingFile
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

export async function completeStateFileRestore(
  manifest: Manifest,
  stateFiles: FileEntry[],
  stateIDToStoreID: Record<string, string>
) {
  const viewStore = useViewStore();

  Object.entries(stateIDToStoreID).forEach(([stateID, storeID]) => {
    viewStore.bindViewsToData(stateID, storeID, manifest);
  });

  if (!manifest.viewByID) {
    const firstStoreID = Object.values(stateIDToStoreID)[0];
    if (firstStoreID) {
      viewStore.setDataForAllViews(firstStoreID);
    }
  }

  useViewConfigStore().deserializeAll(manifest, stateIDToStoreID);

  const segmentGroupIDMap = await useSegmentGroupStore().deserialize(
    manifest,
    stateFiles,
    stateIDToStoreID
  );

  useLayersStore().deserialize(manifest, stateIDToStoreID);

  useToolStore().deserialize(manifest, segmentGroupIDMap, stateIDToStoreID);
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
