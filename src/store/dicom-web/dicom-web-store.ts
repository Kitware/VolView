import { computed, ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
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
  const host = process.env.VUE_APP_DICOM_WEB_URL
    ? ref(process.env.VUE_APP_DICOM_WEB_URL)
    : useLocalStorage<string>('dicomWebHost', '');
  const isConfigured = computed(() => !!host.value);

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
    if (!host.value) return;
    try {
      patients.value = await getAllPatients(host.value);

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
    return fetchInstanceThumbnail(host.value!, instance);
  };

  const fetchPatientMeta = async (patientKey: string) => {
    const dicoms = useDicomMetaStore();
    const studies = await Promise.all(
      dicoms.patientStudies[patientKey]
        .map((studyKey) => dicoms.studyInfo[studyKey])
        .map(({ StudyInstanceUID }) =>
          retrieveStudyMetadata(host.value!, {
            studyInstanceUID: StudyInstanceUID,
          })
        )
    );
    studies.flat().forEach((instance) => dicoms.importMeta(instance));
  };

  const fetchVolumesMeta = async (volumeKeys: string[]) => {
    const dicoms = useDicomMetaStore();
    const studies = await Promise.all(
      volumeKeys.map((volumeKey) => {
        const { SeriesInstanceUID } = dicoms.volumeInfo[volumeKey];
        const { StudyInstanceUID } =
          dicoms.studyInfo[dicoms.volumeStudy[volumeKey]];
        return retrieveSeriesMetadata(host.value!, {
          studyInstanceUID: StudyInstanceUID,
          seriesInstanceUID: SeriesInstanceUID,
        });
      })
    );
    studies.flat().forEach((instance) => dicoms.importMeta(instance));
  };

  const volumes = ref({} as Progress);

  const downloadVolume = async (volumeKey: string) => {
    const datasets = useDatasetStore();
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
        host.value!,
        seriesInfo,
        progressCallback
      );
      if (files) {
        const [loadResult] = await datasets.loadFiles(files.map(makeLocal));
        if (loadResult?.loaded) {
          const selection = convertSuccessResultToDataSelection(loadResult);
          datasets.setPrimarySelection(selection);
          volumes.value[volumeKey] = {
            ...volumes.value[volumeKey],
            state: 'Done',
          };
        } else {
          throw new Error('Failed to load DICOM.');
        }
      } else {
        throw new Error('Fetch came back falsy.');
      }
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
