import { computed, ref, set } from '@vue/composition-api';
import { useLocalStorage, UrlParams } from '@vueuse/core';
import { defineStore } from 'pinia';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';

import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '../datasets';
import { PatientInfo, useDICOMStore } from '../datasets-dicom';
import { useMessageStore } from '../messages';
import { useDicomMetaStore } from './dicom-meta-store';
import {
  searchForStudies,
  fetchSeries,
  fetchInstanceThumbnail,
  retrieveStudyMetadata,
  retrieveSeriesMetadata,
} from '../../core/dicom-web-api';
import { makeLocal } from '../datasets-files';

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

async function getAllPatients(host: string): Promise<PatientInfo[]> {
  const instances = await searchForStudies(host);
  const dicoms = useDicomMetaStore();
  instances.forEach((instance) => dicoms.importMeta(instance));
  return Object.values(dicoms.patientInfo);
}

/**
 * Collect DICOM data from DICOMWeb
 */
export const useDicomWebStore = defineStore('dicom-web', () => {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;
  const dicomWebFromURLParam = urlParams.dicomweb as string | undefined;
  const initialHost = dicomWebFromURLParam ?? process.env.VUE_APP_DICOM_WEB_URL;

  const host = initialHost
    ? ref(initialHost)
    : useLocalStorage<string | null>('dicomWebHost', ''); // null if cleared by vuetify text input

  // Remove trailing slash
  const cleanHost = computed(() => host.value?.replace(/\/$/, '') ?? '');
  const isConfigured = computed(() => !!cleanHost.value);

  const hostName = process.env.VUE_APP_DICOM_WEB_NAME
    ? ref(process.env.VUE_APP_DICOM_WEB_NAME)
    : useLocalStorage<string>('dicomWebHostName', '');

  let hasFetchedPatients = false;
  const message = ref('');
  const patients = ref([] as PatientInfo[]);

  const fetchPatients = async () => {
    hasFetchedPatients = true;
    patients.value = [];
    message.value = '';
    const dicoms = useDicomMetaStore();
    dicoms.$reset();
    if (!cleanHost.value) return;
    try {
      patients.value = await getAllPatients(cleanHost.value);

      if (patients.value.length === 0) {
        message.value = 'Found zero dicoms.';
      }
    } catch (e) {
      message.value =
        'Failed to fetch list of DICOM metadata.  Check address in settings.';
      console.error(e);
    }
  };

  // Safe to call in ephemeral components' setup()
  const fetchPatientsOnce = () => {
    if (!hasFetchedPatients) {
      fetchPatients();
    }
  };

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
    const datasets = useDatasetStore();
    const dicoms = useDicomMetaStore();

    if (!isDownloadable(volumes.value[volumeKey])) return;

    set(volumes.value, volumeKey, {
      ...volumes.value[volumeKey],
      state: 'Pending',
      loaded: 0,
      total: 0,
    });

    const { SeriesInstanceUID: seriesInstanceUID } =
      dicoms.volumeInfo[volumeKey];
    const studyKey = dicoms.volumeStudy[volumeKey];
    const { StudyInstanceUID: studyInstanceUID } = dicoms.studyInfo[studyKey];
    const seriesInfo = { studyInstanceUID, seriesInstanceUID };

    const progressCallback = ({ loaded, total }: ProgressEvent) => {
      set(volumes.value, volumeKey, {
        ...volumes.value[volumeKey],
        loaded,
        total,
      });
    };

    try {
      const files = await fetchSeries(
        cleanHost.value,
        seriesInfo,
        progressCallback
      );
      if (files) {
        const [loadResult] = await datasets.loadFiles(files.map(makeLocal));
        if (loadResult?.loaded) {
          const selection = convertSuccessResultToDataSelection(loadResult);
          datasets.setPrimarySelection(selection);
          set(volumes.value, volumeKey, {
            ...volumes.value[volumeKey],
            state: 'Done',
          });
        } else {
          throw new Error('Failed to load DICOM.');
        }
      } else {
        throw new Error('Fetch came back falsy.');
      }
    } catch (error) {
      const messageStore = useMessageStore();
      messageStore.addError('Failed to load DICOM', error as Error);
      set(volumes.value, volumeKey, {
        ...volumes.value[volumeKey],
        state: 'Error',
        loaded: 0,
      });
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
        set(volumes.value, volumeKey, {
          ...volumes.value[volumeKey],
          state: 'Remote',
          loaded: 0,
        });
    });
  });

  return {
    host,
    isConfigured,
    hostName,
    message,
    patients,
    volumes,
    fetchPatients,
    fetchPatientsOnce,
    fetchPatientMeta,
    fetchVolumesMeta,
    fetchVolumeThumbnail,
    downloadVolume,
  };
});
