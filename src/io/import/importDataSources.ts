import Pipeline, {
  PipelineResult,
  PipelineResultSuccess,
} from '@/src/core/pipeline';
import {
  isConfigResult,
  ImportHandler,
  ImportResult,
  isLoadableResult,
  VolumeResult,
} from '@/src/io/import/common';
import { FileDataSource, DataSource } from '@/src/io/import/dataSource';
import handleDicomFile from '@/src/io/import/processors/handleDicomFile';
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
import { applyConfig } from '@/src/io/import/configJson';
import updateUriType from '@/src/io/import/processors/updateUriType';
import openUriStream from '@/src/io/import/processors/openUriStream';
import downloadStream from '@/src/io/import/processors/downloadStream';

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

function isSelectable(
  result: PipelineResult<DataSource, ImportResult>
): result is PipelineResultSuccess<VolumeResult> {
  if (!result.ok) return false;
  if (result.data.length === 0) {
    return false;
  }
  const importResult = result.data[0];
  if (!isLoadableResult(importResult)) {
    return false;
  }
  if (importResult.dataType === 'model') {
    return false;
  }

  return true;
}

const importConfigs = async (
  results: Array<PipelineResult<DataSource, ImportResult>>
) => {
  try {
    results
      .flatMap((pipelineResult) =>
        pipelineResult.ok ? pipelineResult.data : []
      )
      .filter(isConfigResult)
      .map(({ config }) => config)
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

const importDicomFiles = async (dicomDataSources: Array<FileDataSource>) => {
  const resultSources: DataSource = {
    collectionSrc: {
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
      data: volumeKeys.map((key) => ({
        dataID: key,
        dataType: 'dicom' as const,
        dataSource: resultSources,
      })),
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

export async function importDataSources(
  dataSources: DataSource[]
): Promise<PipelineResult<DataSource, ImportResult>[]> {
  const importContext = {
    fetchFileCache: new Map<string, File>(),
    dicomDataSources: [],
  };

  const middleware = [
    openUriStream,

    // updating the file/uri type should be first step in the pipeline
    updateFileMimeType,
    updateUriType,

    // before extractArchive as .zip extension is part of state file check
    restoreStateFile,
    handleRemoteManifest,
    handleGoogleCloudStorage,
    handleAmazonS3,

    // stream handling
    downloadStream,

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
    // Consuming code expects only errors and image import results.
    // Remove ok results that don't result in something to load (like config.JSON files)
  ].filter((result) => !result.ok || isSelectable(result));
}

export type ImportDataSourcesResult = Awaited<
  ReturnType<typeof importDataSources>
>[number];

export function toDataSelection(loadable: VolumeResult) {
  const { dataID } = loadable;
  return dataID;
}

export function convertSuccessResultToDataSelection(
  result: ImportDataSourcesResult
) {
  if (!isSelectable(result)) return null;
  const importResult = result.data[0];
  return toDataSelection(importResult);
}
