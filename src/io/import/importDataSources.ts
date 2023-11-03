import Pipeline, { PipelineResult } from '@/src/core/pipeline';
import { ImportHandler, ImportResult } from '@/src/io/import/common';
import { DataSource, DataSourceWithFile } from '@/src/io/import/dataSource';
import { nonNullable } from '@/src/utils';
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
import { applyConfig } from '@/src/io/import/configSchema';

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

const importConfigs = async (
  results: Array<PipelineResult<DataSource, ImportResult>>
) => {
  try {
    results
      .flatMap((pipelineResult) =>
        pipelineResult.ok ? pipelineResult.data : []
      )
      .map((result) => result.config)
      .filter(nonNullable)
      .forEach(applyConfig);
    return {
      ok: true as const,
      data: [],
    };
  } catch (err) {
    return {
      ok: false as const,
      errors: [
        {
          message: toMeaningfulErrorString(err),
          cause: err,
          inputDataStackTrace: [],
        },
      ],
    };
  }
};

const importDicomFiles = async (
  dicomDataSources: Array<DataSourceWithFile>
) => {
  const resultSources: DataSource = {
    dicomSrc: {
      sources: dicomDataSources,
    },
  };
  try {
    if (!dicomDataSources.length) {
      return {
        ok: true as const,
        data: [],
      };
    }
    const volumeKeys = await useDICOMStore().importFiles(dicomDataSources);
    return {
      ok: true as const,
      data: volumeKeys.map(
        (key) =>
          ({
            dataID: key,
            dataType: 'dicom' as const,
            dataSource: resultSources,
          } as const)
      ),
    };
  } catch (err) {
    return {
      ok: false as const,
      errors: [
        {
          message: toMeaningfulErrorString(err),
          cause: err,
          inputDataStackTrace: [resultSources],
        },
      ],
    };
  }
};

export async function importDataSources(dataSources: DataSource[]) {
  const importContext = {
    fetchFileCache: new Map<string, File>(),
    dicomDataSources: [] as DataSourceWithFile[],
  };

  const middleware = [
    // updating the file type should be first in the pipeline
    updateFileMimeType,
    // before extractArchive as .zip extension is part of state file check
    restoreStateFile,
    handleRemoteManifest,
    handleGoogleCloudStorage,
    handleAmazonS3,
    downloadUrl,
    extractArchiveTargetFromCache,
    extractArchive,
    handleConfig, // collect config files to apply later
    // should be before importSingleFile, since DICOM is more specific
    handleDicomFile, // collect DICOM files to import later
    importSingleFile,
    // catch any unhandled resource
    unhandledResource,
  ];
  const loader = new Pipeline(middleware);

  const results = await Promise.all(
    dataSources.map((r) => loader.execute(r, importContext))
  );

  const configResult = await importConfigs(results);
  const dicomResult = await importDicomFiles(importContext.dicomDataSources);

  return [
    ...results,
    dicomResult,
    configResult,
    // remove ok results that have no result data
  ].filter((result) => !result.ok || result.data.length);
}

export type ImportDataSourcesResult = Awaited<
  ReturnType<typeof importDataSources>
>[number];

export function convertSuccessResultToDataSelection(
  result: ImportDataSourcesResult
) {
  if (!result.ok) return null;

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
