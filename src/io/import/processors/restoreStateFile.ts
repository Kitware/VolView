import {
  DataSourceType,
  Manifest,
  ManifestSchema,
} from '@/src/io/state-file/schema';
import {
  asErrorResult,
  asOkayResult,
  ImportContext,
  ImportHandler,
  ImportResult,
} from '@/src/io/import/common';
import { DataSource } from '@/src/io/import/dataSource';
import { MANIFEST, isStateFile } from '@/src/io/state-file';
import { partition } from '@/src/utils';
import { pipe } from '@/src/utils/functional';
import {
  makeDefaultSegmentGroupName,
  useSegmentGroupStore,
} from '@/src/store/segmentGroups';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';
import updateFileMimeType from '@/src/io/import/processors/updateFileMimeType';
import extractArchiveTarget from '@/src/io/import/processors/extractArchiveTarget';
import { ChainHandler, evaluateChain, Skip } from '@/src/utils/evaluateChain';
import openUriStream from '@/src/io/import/processors/openUriStream';
import updateUriType from '@/src/io/import/processors/updateUriType';
import handleDicomStream from '@/src/io/import/processors/handleDicomStream';
import downloadStream from '@/src/io/import/processors/downloadStream';
import { FileEntry } from '@/src/io/types';
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

const migrateManifest = (manifestString: string) => {
  const inputManifest = JSON.parse(manifestString);
  return pipe(
    inputManifest,
    migrateOrPass(['1.1.0', '1.0.0', '0.5.0'], migrateBefore210),
    migrateOrPass(['2.1.0'], migrate210To300)
  );
};

type ResolvedResult = {
  type: 'resolved';
  dataSource: DataSource;
};

type ResolvingImportHandler = ChainHandler<
  DataSource,
  ImportResult | ResolvedResult,
  ImportContext
>;

const resolvingHandlers: ResolvingImportHandler[] = [
  openUriStream,

  // updating the file/uri type should be first step in the pipeline
  updateFileMimeType,
  updateUriType,

  // stream handling
  handleDicomStream,
  downloadStream,

  extractArchiveTarget,

  (dataSource) => {
    return { type: 'resolved', dataSource };
  },
];

async function rebuildDataSources(
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
  ): DataSource => {
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
        if (!parent)
          throw new Error('Could not find the parent of an archive source');
        if (parent.type !== 'file')
          throw new Error('Archive source parent is not a file');
        return {
          type: 'archive',
          path: serialized.path,
          parent,
        };
      }
      case 'uri':
        return {
          type: 'uri',
          uri: serialized.uri,
          name: serialized.name,
          mime: serialized.mime,
        };
      case 'collection': {
        // these sources are no longer leaves
        serialized.sources.forEach((id) => {
          leaves.delete(id);
        });
        const sources = serialized.sources.map((id) => dataSourceCache[id]);
        if (sources.some((src) => !src))
          throw new Error('Could not deserialize a collection source');
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

  // serializedDataSources should be topologically ordered by ancestors first
  // and descendants last. This is established in
  // datasets.ts/serializeDataSource()
  for (let i = 0; i < serializedDataSources.length; i++) {
    const serializedSrc = serializedDataSources[i];

    if (serializedSrc.id in dataSourceCache) {
      // eslint-disable-next-line no-continue
      continue;
    }

    let dataSource = deserialize(serializedSrc);

    if (serializedSrc.parent) {
      dataSource.parent = dataSourceCache[serializedSrc.parent];
      leaves.delete(serializedSrc.parent);
    }

    let stillResolving = true;
    while (stillResolving) {
      // eslint-disable-next-line no-await-in-loop
      const result = await evaluateChain(dataSource, resolvingHandlers);

      stillResolving = result.type !== 'resolved';
      if (!stillResolving) break;

      if (result.type !== 'intermediate') {
        throw new Error(
          'Resolving pipeline does not produce intermediate results!'
        );
      }

      dataSource = result.dataSources[0];
    }

    dataSourceCache[serializedSrc.id] = dataSource;
  }

  return { dataSourceCache, leaves };
}

async function restoreDatasets(
  manifest: Manifest,
  datasetFiles: FileEntry[],
  context?: ImportContext
) {
  const { datasets, dataSources, datasetFilePath } = manifest;
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

  const { dataSourceCache, leaves } = await rebuildDataSources(
    dataSources,
    fileIDToFile
  );

  const stateIDToStoreID: Record<string, string> = {};

  await Promise.all(
    [...leaves].map(async (leafId) => {
      const dataSource = dataSourceCache[leafId];
      const importResult =
        (await context?.importDataSources?.([dataSource])) ?? [];
      const [result] = importResult;
      if (result?.type !== 'data' || importResult.length !== 1)
        throw new Error('Expected a single dataset');

      stateIDToStoreID[dataSourceIDToStateID[leafId]] = result.dataID;
    })
  );

  return stateIDToStoreID;
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

    // We restore the view first, so that the appropriate watchers are triggered
    // in the views as the data is loaded
    useViewStore().setLayout(manifest.layout);

    const stateIDToStoreID = await restoreDatasets(
      manifest,
      restOfStateFile,
      context
    );

    // Restore the views
    useViewStore().deserialize(manifest, stateIDToStoreID);

    // Restore view configs
    useViewConfigStore().deserializeAll(manifest, stateIDToStoreID);

    // Restore the labelmaps
    const segmentGroupIDMap = await useSegmentGroupStore().deserialize(
      manifest,
      restOfStateFile,
      stateIDToStoreID
    );

    // Restore the tools
    useToolStore().deserialize(manifest, segmentGroupIDMap, stateIDToStoreID);

    useLayersStore().deserialize(manifest, stateIDToStoreID);

    return asOkayResult(dataSource);
  }
  return Skip;
};

export default restoreStateFile;
