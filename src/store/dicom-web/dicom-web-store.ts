import { computed, ref, watch } from 'vue';
import { useLocalStorage, UrlParams } from '@vueuse/core';
import { defineStore } from 'pinia';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';

import { omit, remapKeys } from '@/src/utils';
import { fileToDataSource } from '@/src/io/import/dataSource';
import {
  convertSuccessResultToDataSelection,
  importDataSources,
} from '@/src/io/import/importDataSources';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useMessageStore } from '@/src/store/messages';
import { useDicomMetaStore } from '@/src/store/dicom-web/dicom-meta-store';
import {
  searchForStudies,
  fetchSeries,
  fetchInstanceThumbnail,
  retrieveStudyMetadata,
  retrieveSeriesMetadata,
  parseUrl,
} from '@/src/core/dicom-web-api';
import { useViewStore } from '@/src/store/views';

const DICOM_WEB_URL_PARAM = 'dicomweb';

export type ProgressState = 'Remote' | 'Pending' | 'Error' | 'Done';

export interface VolumeProgress {
  state: ProgressState;
  loaded: number;
  total: number;
}

interface Progress {
  [name: string]: VolumeProgress;
}

export const isDownloadable = (progress?: VolumeProgress) =>
  !progress || ['Pending', 'Done'].every((state) => state !== progress.state);

const fetchFunctions = {
  host: searchForStudies,
  studies: retrieveStudyMetadata,
  series: retrieveSeriesMetadata,
};

const levelToFetchKey = {
  studies: 'studyInstanceUID',
  series: 'seriesInstanceUID',
};

const levelToMetaKey = {
  studies: 'StudyInstanceUID',
  series: 'SeriesInstanceUID',
};

type InitialDicomListFetchProgress = 'Idle' | 'Pending' | 'Done';

/**
 * Collect DICOM data from DICOMWeb
 */
export const useDicomWebStore = defineStore('dicom-web', () => {
  const { VITE_DICOM_WEB_NAME, VITE_DICOM_WEB_URL } = import.meta.env;
  // GUI display name
  const hostName = VITE_DICOM_WEB_NAME
    ? ref(VITE_DICOM_WEB_NAME)
    : useLocalStorage<string>('dicomWebHostName', '');

  // URL param overrides env var, which overrides local storage
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;
  const dicomWebFromURLParam = urlParams[DICOM_WEB_URL_PARAM] as
    | string
    | undefined;
  const hostConfig = dicomWebFromURLParam ?? VITE_DICOM_WEB_URL;

  // Don't save URL param or env var to local storage. Only save user input.
  const savedHost = useLocalStorage<string | null>('dicomWebHost', ''); // null if cleared by vuetify text input

  const host = ref<string | null>(hostConfig ?? savedHost.value);

  watch(savedHost, () => {
    host.value = savedHost.value;
  });

  // Remove trailing slash and pull study/series IDs from URL
  const parsedURL = computed(() => parseUrl(host.value ?? ''));

  const cleanHost = computed(() => parsedURL.value.host);
  const isConfigured = computed(() => !!cleanHost.value);

  const fetchVolumeThumbnail = async (volumeKey: string) => {
    const dicoms = useDicomMetaStore();
    const volumeInfo = dicoms.volumeInfo[volumeKey];
    const middleSlice = Math.floor(volumeInfo.NumberOfSlices / 2);
    const middleInstance = dicoms.volumeInstances[volumeKey]
      .map((instanceKey) => dicoms.instanceInfo[instanceKey])
      .sort(
        ({ InstanceNumber: a }, { InstanceNumber: b }) => Number(a) - Number(b)
      )[middleSlice];

    const studyKey = dicoms.volumeStudy[volumeKey];
    const studyInfo = dicoms.studyInfo[studyKey];
    const instance = {
      studyInstanceUID: studyInfo.StudyInstanceUID,
      seriesInstanceUID: volumeInfo.SeriesInstanceUID,
      sopInstanceUID: middleInstance.SopInstanceUID,
    };
    return fetchInstanceThumbnail(cleanHost.value, instance);
  };

  const fetchPatientMeta = async (patientKey: string) => {
    const dicoms = useDicomMetaStore();
    const series = await Promise.all(
      dicoms.patientStudies[patientKey]
        .map((studyKey) => dicoms.studyInfo[studyKey])
        .map(async (studyMeta) => {
          const seriesMetas = await retrieveStudyMetadata(cleanHost.value, {
            studyInstanceUID: studyMeta.StudyInstanceUID,
          });
          return seriesMetas.map((seriesMeta) => ({
            ...studyMeta,
            ...seriesMeta,
          }));
        })
    );
    series.flat().forEach((instance) => dicoms.importMeta(instance));
  };

  const fetchVolumesMeta = async (volumeKeys: string[]) => {
    const dicoms = useDicomMetaStore();
    const series = await Promise.all(
      volumeKeys.map(async (volumeKey) => {
        const volumeMeta = dicoms.volumeInfo[volumeKey];
        const studyMeta = dicoms.studyInfo[dicoms.volumeStudy[volumeKey]];
        const instanceMetas = await retrieveSeriesMetadata(cleanHost.value, {
          studyInstanceUID: studyMeta.StudyInstanceUID,
          seriesInstanceUID: volumeMeta.SeriesInstanceUID,
        });
        return instanceMetas.map((instanceMeta) => ({
          ...studyMeta,
          ...volumeMeta,
          ...instanceMeta,
        }));
      })
    );
    series.flat().forEach((instance) => dicoms.importMeta(instance));
  };

  const volumes = ref({} as Progress);

  const downloadVolume = async (volumeKey: string) => {
    const dicoms = useDicomMetaStore();

    if (!isDownloadable(volumes.value[volumeKey])) return;

    volumes.value[volumeKey] = {
      ...volumes.value[volumeKey],
      state: 'Pending',
      loaded: 0,
      total: 0,
    };

    const { SeriesInstanceUID: seriesInstanceUID } =
      dicoms.volumeInfo[volumeKey];
    const studyKey = dicoms.volumeStudy[volumeKey];
    const { StudyInstanceUID: studyInstanceUID } = dicoms.studyInfo[studyKey];
    const seriesInfo = { studyInstanceUID, seriesInstanceUID };

    const progressCallback = ({ loaded, total }: ProgressEvent) => {
      volumes.value[volumeKey] = {
        ...volumes.value[volumeKey],
        loaded,
        total,
      };
    };

    try {
      const files = await fetchSeries(
        cleanHost.value,
        seriesInfo,
        progressCallback
      );

      if (!files) {
        throw new Error('Could not fetch series');
      }

      const [loadResult] = await importDataSources(files.map(fileToDataSource));
      if (!loadResult) {
        throw new Error('Did not receive a load result');
      }
      if (loadResult.type === 'error') {
        throw loadResult.error;
      }

      const selection = convertSuccessResultToDataSelection(loadResult);
      useViewStore().setDataForAllViews(selection);
      volumes.value[volumeKey] = {
        ...volumes.value[volumeKey],
        state: 'Done',
      };
    } catch (error) {
      const messageStore = useMessageStore();
      messageStore.addError('Failed to load DICOM', error as Error);
      volumes.value[volumeKey] = {
        ...volumes.value[volumeKey],
        state: 'Error',
        loaded: 0,
      };
    }
  };

  const fetchDicomsProgress = ref<InitialDicomListFetchProgress>('Idle');
  const fetchError = ref<undefined | unknown>(undefined);
  // DICOMWeb DataBrowser components automatically expands panels if true
  const linkedToStudyOrSeries = ref(false);
  const fetchDicoms = async () => {
    fetchDicomsProgress.value = 'Pending';
    fetchError.value = undefined;
    linkedToStudyOrSeries.value = false;

    const dicoms = useDicomMetaStore();
    dicoms.$reset();
    if (!cleanHost.value) return;

    const deepestLevel = Object.keys(
      parsedURL.value
    ).pop() as keyof typeof fetchFunctions; // at least host key guaranteed to exist

    linkedToStudyOrSeries.value =
      deepestLevel === 'studies' || deepestLevel === 'series';

    const fetchFunc = fetchFunctions[deepestLevel];
    const urlIDs = omit(parsedURL.value, 'host');
    const fetchOptions = remapKeys(urlIDs, levelToFetchKey);
    try {
      const fetchedMetas = await fetchFunc(
        cleanHost.value,
        fetchOptions as any
      );

      const urlMetaIDs = remapKeys(urlIDs, levelToMetaKey);

      const fullMeta = fetchedMetas.map((fetchedMeta) => ({
        ...urlMetaIDs,
        ...fetchedMeta,
      }));
      fullMeta.forEach((instance) => dicoms.importMeta(instance));
    } catch (error) {
      fetchError.value = error;
      console.error(error);
    }

    if (deepestLevel === 'series') {
      const seriesID = Object.values(parsedURL.value).pop() as string;
      downloadVolume(seriesID);
    }

    fetchDicomsProgress.value = 'Done';
  };

  const message = computed(() => {
    if (fetchError.value)
      return `Error fetching DICOMWeb data: ${fetchError.value}`;

    const dicoms = useDicomMetaStore();
    if (
      fetchDicomsProgress.value === 'Done' &&
      Object.values(dicoms.patientInfo).length === 0
    )
      return 'Found zero dicoms.';

    return '';
  });

  // Safe to call in components' setup()
  let lastFetchedHostUrl: string | null = '';
  const fetchDicomsOnce = () => {
    if (lastFetchedHostUrl !== host.value || message.value) {
      lastFetchedHostUrl = host.value;
      fetchDicoms();
    }
  };

  const loadedDicoms = useDICOMStore();
  loadedDicoms.$onAction(({ name, args, after }) => {
    if (name !== 'deleteVolume') return;

    after(() => {
      const [loadedVolumeKey] = args;
      const volumeKey = Object.keys(volumes.value).find((key) =>
        loadedVolumeKey.startsWith(key)
      );
      if (volumeKey)
        volumes.value[volumeKey] = {
          ...volumes.value[volumeKey],
          state: 'Remote',
          loaded: 0,
        };
    });
  });

  return {
    host,
    savedHost,
    isConfigured,
    hostName,
    message,
    volumes,
    linkedToStudyOrSeries,
    fetchDicomsOnce,
    fetchPatientMeta,
    fetchVolumesMeta,
    fetchVolumeThumbnail,
    downloadVolume,
  };
});
