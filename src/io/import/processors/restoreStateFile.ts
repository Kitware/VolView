import { Dataset, Manifest, ManifestSchema } from '@/src/io/state-file/schema';
import { FileEntry } from '@/src/io/types';
import * as path from '@/src/utils/path';
import {
  ArchiveContents,
  ImportContext,
  ImportHandler,
  ImportResult,
} from '@/src/io/import/common';
import {
  DataSource,
  convertDataSourceToDatasetFile,
  convertDatasetFileToDataSource,
} from '@/src/io/import/dataSource';
import { MANIFEST, isStateFile } from '@/src/io/state-file';
import { ZipDatasetFile } from '@/src/store/datasets-files';
import { partition } from '@/src/utils';
import Pipeline, { PipelineContext } from '@/src/core/pipeline';
import { Awaitable } from '@vueuse/core';
import doneWithDataSource from '@/src/io/import/processors/doneWithDataSource';
import extractArchiveTarget from '@/src/io/import/processors/extractArchiveTarget';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useViewStore } from '@/src/store/views';
import {
  DataSelection,
  makeDICOMSelection,
  makeImageSelection,
  useDatasetStore,
} from '@/src/store/datasets';
import { useLabelmapStore } from '@/src/store/datasets-labelmaps';
import { useToolStore } from '@/src/store/tools';
import { useLayersStore } from '@/src/store/datasets-layers';
import { extractFilesFromZip } from '@/src/io/zip';

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
    .map((entry) => convertDatasetFileToDataSource(entry));

  // constructs a DataSource of the following form:
  // { archiveSrc, parent: { uriSrc } }
  const remotes = (manifest.remoteFiles[dataset.id] ?? []).map((entry) => {
    const source = convertDatasetFileToDataSource({
      ...entry,
      // dummy file used to get the file name.
      // We will delete the fileSrc afterwards.
      file: new File([], entry.name),
    });
    delete source.fileSrc;
    return source;
  });

  return [...inStateFile, ...remotes];
}

type Context = PipelineContext<DataSource, ImportResult, ImportContext>;

async function restoreDatasets(
  manifest: Manifest,
  datasetFiles: ZipDatasetFile[],
  { extra, execute }: Context
) {
  const archiveCache = new Map<File, Awaitable<ArchiveContents>>();

  const resolvePipeline = new Pipeline([
    extractArchiveTarget,
    doneWithDataSource,
  ]);

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
      const dicomSources: DataSource[] = [];
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
        const volumeKeys = await dicomStore.importFiles(
          dicomSources.map((src) => convertDataSourceToDatasetFile(src))
        );
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

        const { dataID } = result.data[0];
        if (!dataID) {
          throw new Error('Failed to import dataset');
        }

        stateIDToStoreID[dataset.id] = dataID;
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
    const stateFileContents = (await extractFilesFromZip(
      fileSrc.file
    )) as Array<ZipDatasetFile>;

    const [manifests, restOfStateFile] = partition(
      (dataFile) => dataFile.file.name === MANIFEST,
      stateFileContents
    );

    if (manifests.length !== 1) {
      throw new Error('State file does not have exactly 1 manifest');
    }

    const manifest = ManifestSchema.parse(
      JSON.parse(await manifests[0].file.text())
    );

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
    const labelmapIDMap = await useLabelmapStore().deserialize(
      manifest,
      restOfStateFile,
      stateIDToStoreID
    );

    // Restore the tools
    useToolStore().deserialize(manifest, labelmapIDMap, stateIDToStoreID);

    useLayersStore().deserialize(manifest, stateIDToStoreID);

    // TODO return statuses
    return done();
  }
  return dataSource;
};

export default restoreStateFile;
