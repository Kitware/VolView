import { PipelineResult } from '@/src/core/pipeline';
import { ImportResult } from '@/src/io/import/common';
import {
  DataSource,
  convertDatasetFileToDataSource,
} from '@/src/io/import/dataSource';
import { importDataSources } from '@/src/io/import/importDataSources';
import { makeDICOMSelection, makeImageSelection } from '@/src/store/datasets';
import { DatasetFile } from '@/src/store/datasets-files';

export type ImportFilesResult = PipelineResult<DataSource, ImportResult>;

export function convertSuccessResultToDataSelection(result: ImportFilesResult) {
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

export default async function importFiles(files: DatasetFile[]) {
  const resources = files.map((file): DataSource => {
    // treat empty remote files as just URLs to download
    return convertDatasetFileToDataSource(file, {
      forceRemoteOnly: file.file.size === 0,
    });
  });

  return importDataSources(resources);
}
