import Pipeline, { PipelineResult } from '@/src/core/pipeline';
import { ImportHandler, ImportResult } from '@/src/io/import/common';
import { DataSource, DataSourceWithFile } from '@/src/io/import/dataSource';
import handleDicomFile from '@/src/io/import/processors/handleDicomFile';
import downloadUrl from '@/src/io/import/processors/downloadUrl';
import extractArchive from '@/src/io/import/processors/extractArchive';
import extractArchiveTargetFromCache from '@/src/io/import/processors/extractArchiveTarget';
import handleAmazonS3 from '@/src/io/import/processors/handleAmazonS3';
import handleGoogleCloudStorage from '@/src/io/import/processors/handleGoogleCloudStorage';
import importSingleFile from '@/src/io/import/processors/importSingleFile';
import handleRemoteManifest from '@/src/io/import/processors/remoteManifest';
import restoreStateFile from '@/src/io/import/processors/restoreStateFile';
import updateFileMimeType from '@/src/io/import/processors/updateFileMimeType';
import handleConfig from '@/src/io/import/processors/handleConfig';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { makeDICOMSelection, makeImageSelection } from '@/src/store/datasets';

export type ImportDataSourcesResult = PipelineResult<DataSource, ImportResult>;

export function convertSuccessResultToDataSelection(
  result: ImportDataSourcesResult
) {
  if (result.data.length === 0) {
    return null;
  }

  const { dataID, dataType } = result.data[0];
  if (!dataID) {
    return null;
  }

  if (dataType === 'dicom') {
    return makeDICOMSelection(dataID);
  }

  if (dataType === 'image') {
    return makeImageSelection(dataID);
  }

  return null;
}

/**
 * Tries to turn a thrown object into a meaningful error string.
 * @param error
 * @returns
 */
function toMeaningfulErrorString(thrown: unknown) {
  const strThrown = String(thrown);
  if (!strThrown || strThrown === '[object Object]') {
    return 'Unknown error. More details in the dev console.';
  }
  return strThrown;
}

const unhandledResource: ImportHandler = () => {
  throw new Error('Failed to handle resource');
};

export async function importDataSources(dataSources: DataSource[]) {
  const middleware: Array<ImportHandler> = [
    // updating the file type should be first in the pipeline
    updateFileMimeType,
    // handleConfig must be for restoreStateFile for label props to be applied to deserialized tools
    handleConfig,
    restoreStateFile,
    handleRemoteManifest,
    handleGoogleCloudStorage,
    handleAmazonS3,
    downloadUrl,
    extractArchiveTargetFromCache,
    extractArchive,
    // should be before importSingleFile, since DICOM is more specific
    handleDicomFile,
    importSingleFile,
    // catch any unhandled resource
    unhandledResource,
  ];

  const importContext = {
    fetchFileCache: new Map<string, File>(),
    dicomDataSources: [] as DataSourceWithFile[],
  };

  const pipeline = new Pipeline(middleware);
  const results = await Promise.all(
    dataSources.map((r) => pipeline.execute(r, importContext))
  );

  if (!importContext.dicomDataSources.length) {
    return results;
  }

  // handle DICOM loading

  const dicomDataSource: DataSource = {
    dicomSrc: {
      sources: importContext.dicomDataSources,
    },
  };
  const dicomResult: PipelineResult<DataSource, ImportResult> = {
    ok: true,
    data: [],
    errors: [],
  };

  try {
    const volumeKeys = await useDICOMStore().importFiles(
      importContext.dicomDataSources
    );
    dicomResult.data.push(
      ...volumeKeys.map((key) => ({
        dataID: key,
        dataType: 'dicom' as const,
        dataSource: dicomDataSource,
      }))
    );
  } catch (err) {
    dicomResult.ok = false;
    dicomResult.errors.push({
      message: toMeaningfulErrorString(err),
      cause: err,
      inputDataStackTrace: [dicomDataSource],
    });
  }

  // remove all results that have no result data
  return [...results.filter((result) => result.data.length), dicomResult];
}
