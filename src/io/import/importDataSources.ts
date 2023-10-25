import Pipeline, {
  PipelineResult,
  PipelineResultError,
  PipelineResultSuccess,
  partitionResults,
} from '@/src/core/pipeline';
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
import {
  EARLIEST_PRIORITY,
  earliestPriority,
  prioritizeJSON,
  prioritizeStateFile,
  PriorityResult,
} from './processors/prioritize';

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
  const importContext = {
    fetchFileCache: new Map<string, File>(),
    dicomDataSources: [] as DataSourceWithFile[],
  };

  const prioritizes = [
    // updating the file type should be first in the pipeline
    updateFileMimeType,
    // before extractArchive as .zip file is part of state file check
    prioritizeStateFile,

    // source generators
    handleRemoteManifest,
    handleGoogleCloudStorage,
    handleAmazonS3,
    downloadUrl,
    extractArchiveTargetFromCache,
    extractArchive,

    // sinks
    prioritizeJSON,
    earliestPriority,
  ];
  const prioritizer = new Pipeline<
    DataSource,
    PriorityResult | ImportResult,
    typeof importContext
  >(prioritizes);

  const priorityOrImportResult = await Promise.all(
    dataSources.map((r) => prioritizer.execute(r, importContext))
  );

  const [fetchSuccess, errorOnDataFetches] = partitionResults(
    priorityOrImportResult
  );

  const withPriority = fetchSuccess
    .flatMap((r) => r.data)
    .map((importOrPriority) => {
      return {
        dataSource: importOrPriority.dataSource,
        priority:
          'priority' in importOrPriority
            ? importOrPriority.priority
            : EARLIEST_PRIORITY,
      };
    });

  // Group same priorities, lowest priority first
  const priorityBuckets = withPriority.reduce((buckets, result) => {
    const { priority = 0 } = result;
    if (!buckets[priority]) {
      // eslint-disable-next-line no-param-reassign
      buckets[priority] = [];
    }
    buckets[priority].push(result.dataSource);
    return buckets;
  }, [] as Array<Array<DataSource>>);

  const loaders = [
    restoreStateFile,
    handleConfig,
    // should be before importSingleFile, since DICOM is more specific
    handleDicomFile,
    importSingleFile,
    // catch any unhandled resource
    unhandledResource,
  ];
  const fileLoader = new Pipeline(loaders);

  // Serially processes buckets by priority.
  // Configuration in later priority buckets will override earlier ones.
  const results = [] as Array<PipelineResult<DataSource, ImportResult>>;
  for (let i = 0; i < priorityBuckets.length; i++) {
    const sources = priorityBuckets[i];
    // sparse array, so check for undefined
    if (sources) {
      // eslint-disable-next-line no-await-in-loop
      const bucketResults = await Promise.all(
        sources.map((dataSource) =>
          fileLoader.execute(dataSource, importContext)
        )
      );
      results.push(...bucketResults);
    }
  }

  if (!importContext.dicomDataSources.length) {
    return [...errorOnDataFetches, ...results];
  }

  // handle DICOM loading
  const dicomDataSource: DataSource = {
    dicomSrc: {
      sources: importContext.dicomDataSources,
    },
  };
  const dicomResult = await (async () => {
    try {
      const volumeKeys = await useDICOMStore().importFiles(
        importContext.dicomDataSources
      );
      return {
        ok: true,
        data: volumeKeys.map((key) => ({
          dataID: key,
          dataType: 'dicom' as const,
          dataSource: dicomDataSource,
        })),
      } as PipelineResultSuccess<ImportResult>;
    } catch (err) {
      return {
        ok: false,
        errors: [
          {
            message: toMeaningfulErrorString(err),
            cause: err,
            inputDataStackTrace: [dicomDataSource],
          },
        ],
      } as PipelineResultError<typeof dicomDataSource>;
    }
  })();

  return [
    ...errorOnDataFetches,
    // remove all results that have no result data
    ...results.filter((result) => !result.ok || result.data.length),
    dicomResult,
  ];
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
