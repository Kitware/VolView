import { Dataset, Manifest, ManifestSchema } from '@/src/io/state-file/schema';
import { FileEntry } from '@/src/io/types';
import * as path from '@/src/utils/path';
import {
  ArchiveContents,
  ImportContext,
  ImportHandler,
  ImportResult,
  isLoadableResult,
} from '@/src/io/import/common';
import {
  DataSource,
  DataSourceWithFile,
  fileToDataSource,
} from '@/src/io/import/dataSource';
import { MANIFEST, isStateFile } from '@/src/io/state-file';
import { ensureError, partition } from '@/src/utils';
import Pipeline, { PipelineContext } from '@/src/core/pipeline';
import { Awaitable } from '@vueuse/core';
import doneWithDataSource from '@/src/io/import/processors/doneWithDataSource';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useViewStore } from '@/src/store/views';
import {
  DataSelection,
  makeDICOMSelection,
  makeImageSelection,
  useDatasetStore,
} from '@/src/store/datasets';
import {
  makeDefaultSegmentGroupName,
  useSegmentGroupStore,
} from '@/src/store/segmentGroups';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';
import downloadUrl from '@/src/io/import/processors/downloadUrl';
import updateFileMimeType from '@/src/io/import/processors/updateFileMimeType';
import extractArchiveTarget from '@/src/io/import/processors/extractArchiveTarget';

const LABELMAP_PALETTE_2_1_0 = {
  '0': {
    value: 0,
    name: 'Segment 0',
    color: [0, 0, 0, 0],
  },
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

const OLD_MANIFEST_VERSIONS = ['2.1.0', '1.1.0', '1.0.0', '0.5.0'];

const migrateManifest = (manifestString: string) => {
  const inputManifest = JSON.parse(manifestString);

  if (
    OLD_MANIFEST_VERSIONS.some(
      (oldVersion) => oldVersion === inputManifest.version
    )
  ) {
    inputManifest.tools.paint.activeSegmentGroupID =
      inputManifest.tools.paint.activeLabelmapID;
    delete inputManifest.tools.paint.activeLabelmapID;

    const order = Object.keys(LABELMAP_PALETTE_2_1_0).map((key) => Number(key));
    inputManifest.labelMaps = inputManifest.labelMaps.map(
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

    inputManifest.version = '3.0.0';
  }

  return inputManifest;
};

const resolveUriSource: ImportHandler = async (dataSource, { extra, done }) => {
  const { uriSrc } = dataSource;

  if (uriSrc) {
    const result = await new Pipeline([
      downloadUrl,
      updateFileMimeType,
      doneWithDataSource,
    ]).execute(dataSource, extra);
    if (!result.ok) {
      throw result.errors[0].cause;
    }
    // downloadUrl returns the fully resolved data source.
    // We call done here since we've resolved the UriSource
    // and no more processing is needed.
    return done({
      dataSource: result.data[0].dataSource,
    });
  }

  return dataSource;
};

const processParentIfNoFile: ImportHandler = async (
  dataSource,
  { execute }
) => {
  const { fileSrc, parent } = dataSource;
  if (!fileSrc && parent) {
    const result = await execute(parent);
    if (!result.ok) {
      throw new Error('Could not process parent', {
        cause: ensureError(result.errors[0].cause),
      });
    }
    // update the parent
    return {
      ...dataSource,
      parent: result.data[0].dataSource,
    };
  }
  return dataSource;
};

const resolveArchiveMember: ImportHandler = async (
  dataSource,
  { extra, done }
) => {
  if (dataSource.archiveSrc) {
    const pipeline = new Pipeline([
      extractArchiveTarget,
      updateFileMimeType,
      doneWithDataSource,
    ]);
    const result = await pipeline.execute(dataSource, extra);
    if (!result.ok) {
      throw result.errors[0].cause;
    }
    // extractArchiveTarget returns the fully resolved data source.
    return done({
      dataSource: result.data[0].dataSource,
    });
  }
  return dataSource;
};

function getDataSourcesForDataset(
  dataset: Dataset,
  manifest: Manifest,
  stateFileContents: FileEntry[]
) {
  const inStateFile = stateFileContents
    .filter(
      (entry) =>
        path.normalize(entry.archivePath) === path.normalize(dataset.path)
    )
    .map((entry) => fileToDataSource(entry.file));
  const remotes = manifest.remoteFiles[dataset.id] ?? [];
  return [...inStateFile, ...remotes];
}

async function restoreDatasets(
  manifest: Manifest,
  datasetFiles: FileEntry[],
  { extra, execute }: PipelineContext<DataSource, ImportResult, ImportContext>
) {
  const archiveCache = new Map<File, Awaitable<ArchiveContents>>();

  // normalize archive paths for comparison
  const stateDatasetFiles = datasetFiles.map((datasetFile) => {
    return {
      ...datasetFile,
      archivePath: path.normalize(datasetFile.archivePath),
    };
  });

  const { datasets } = manifest;
  // Mapping of the state file ID => new store ID
  const stateIDToStoreID: Record<string, string> = {};

  // This pipeline resolves data sources that have remote provenance.
  const resolvePipeline = new Pipeline([
    updateFileMimeType,
    resolveUriSource,
    // process parent after resolving the uri source, so we don't
    // unnecessarily download ancestor UriSources.
    processParentIfNoFile,
    resolveArchiveMember,
    doneWithDataSource,
  ]);

  await Promise.all(
    datasets.map(async (dataset) => {
      let datasetDataSources = getDataSourcesForDataset(
        dataset,
        manifest,
        stateDatasetFiles
      );

      // resolve any remote data sources or archive members
      datasetDataSources = await Promise.all(
        datasetDataSources.map(async (source) => {
          const result = await resolvePipeline.execute(source, {
            ...extra,
            archiveCache,
          });
          if (!result.ok) {
            throw result.errors[0].cause;
          }
          return result.data[0].dataSource;
        })
      );

      // do the import
      const dicomSources: DataSourceWithFile[] = [];
      const importResults = await Promise.all(
        datasetDataSources.map((source) =>
          execute(source, {
            ...extra,
            archiveCache,
            dicomDataSources: dicomSources,
          })
        )
      );

      if (dicomSources.length) {
        const dicomStore = useDICOMStore();
        const volumeKeys = await dicomStore.importFiles(dicomSources);
        if (volumeKeys.length !== 1) {
          throw new Error('Obtained more than one volume from DICOM import');
        }

        const [key] = volumeKeys;
        // generate imageID so rulers and labelmaps can use stateIDToStoreID to setup there internal imageStore imageID references
        await dicomStore.buildVolume(key);
        stateIDToStoreID[dataset.id] = key;
      } else if (importResults.length === 1) {
        if (!importResults[0].ok) {
          throw importResults[0].errors[0].cause;
        }

        const [result] = importResults;
        if (result.data.length !== 1) {
          throw new Error(
            'Import encountered multiple volumes for a single dataset'
          );
        }

        const importResult = result.data[0];
        if (!isLoadableResult(importResult)) {
          throw new Error('Failed to import dataset');
        }

        stateIDToStoreID[dataset.id] = importResult.dataID;
      } else {
        throw new Error('Could not load any data from the session');
      }
    })
  );

  return stateIDToStoreID;
}

const restoreStateFile: ImportHandler = async (
  dataSource,
  { done, extra, execute }
) => {
  const { fileSrc } = dataSource;
  if (fileSrc && (await isStateFile(fileSrc.file))) {
    const stateFileContents = await extractFilesFromZip(fileSrc.file);

    const [manifests, restOfStateFile] = partition(
      (dataFile) => dataFile.file.name === MANIFEST,
      stateFileContents
    );

    if (manifests.length !== 1) {
      throw new Error('State file does not have exactly 1 manifest');
    }

    const manifestString = await manifests[0].file.text();
    const migrated = migrateManifest(manifestString);
    const manifest = ManifestSchema.parse(migrated);

    // We restore the view first, so that the appropriate watchers are triggered
    // in the views as the data is loaded
    useViewStore().setLayout(manifest.layout);

    const stateIDToStoreID = await restoreDatasets(manifest, restOfStateFile, {
      extra,
      execute,
      done,
    });

    // Restore the primary selection
    if (manifest.primarySelection !== undefined) {
      const selectedID = stateIDToStoreID[manifest.primarySelection];
      let dataSelection: DataSelection | undefined;

      if (selectedID in useDICOMStore().volumeInfo) {
        dataSelection = makeDICOMSelection(selectedID);
      } else {
        dataSelection = makeImageSelection(selectedID);
      }

      useDatasetStore().setPrimarySelection(dataSelection);
    }

    // Restore the views
    useViewStore().deserialize(manifest.views, stateIDToStoreID);

    // Restore the labelmaps
    const segmentGroupIDMap = await useSegmentGroupStore().deserialize(
      manifest,
      restOfStateFile,
      stateIDToStoreID
    );

    // Restore the tools
    useToolStore().deserialize(manifest, segmentGroupIDMap, stateIDToStoreID);

    useLayersStore().deserialize(manifest, stateIDToStoreID);

    return done();
  }
  return dataSource;
};

export default restoreStateFile;
