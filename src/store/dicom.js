import Vue from 'vue';
import vtkITKHelper from 'vtk.js/Sources/Common/DataModel/ITKHelper';

import { pick } from '@/src/utils/common';

export const ANONYMOUS_PATIENT = 'Anonymous';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

export function imageCacheMultiKey(offset, asThumbnail) {
  return `${offset}!!${asThumbnail}`;
}

/**
 * Generate a synthetic multi-key patient key from a Patient object.
 *
 * Required keys in the Patient object:
 * - PatientName
 * - PatientID
 * - PatientBirthDate
 * - PatientSex
 *
 * @param {Patient} patient
 */
export function genSynPatientKey(patient) {
  const pid = patient.PatientID.trim();
  const name = patient.PatientName.trim();
  const bdate = patient.PatientBirthDate.trim();
  const sex = patient.PatientSex.trim();
  // we only care about making a unique key here. The
  // data doesn't actually matter.
  return [pid, name, bdate, sex].map((s) => s.replace('|', '_')).join('|');
}

export default (dependencies) => ({
  namespaced: true,

  state: {
    patientIndex: {}, // patientKey -> Patient
    patientStudies: {}, // patientID -> [studyKey]; use patientID to combine Anonymous patients
    studyIndex: {}, // studyKey -> Study
    studySeries: {}, // studyUID -> [seriesKey]
    seriesIndex: {}, // seriesKey -> Series
    imageIndex: {},

    // TODO move caches out of state to avoid making entire objects reactive
    // image slice cache
    imageCache: {}, // seriesKey -> { imageCacheMultiKey: ITKImage }
    // series volume cache
    volumeCache: {}, // seriesKey -> ItkImage or vtk image?
  },

  mutations: {
    addPatient(state, { patientKey, patient }) {
      if (!(patientKey in state.patientIndex)) {
        state.patientIndex = {
          ...state.patientIndex,
          [patientKey]: patient,
        };
      }
    },

    addStudy(state, { studyKey, study, patientID }) {
      if (!(studyKey in state.studyIndex)) {
        state.studyIndex = {
          ...state.studyIndex,
          [studyKey]: study,
        };
        state.studyIndex[studyKey] = study;
        state.patientStudies[patientID] = state.patientStudies[patientID] ?? [];
        state.patientStudies[patientID].push(studyKey);
      }
    },

    addSeries(state, { seriesKey, series, studyUID }) {
      if (!(seriesKey in state.seriesIndex)) {
        state.seriesIndex = {
          ...state.seriesIndex,
          [seriesKey]: series,
        };
        state.studySeries[studyUID] = state.studySeries[studyUID] ?? [];
        state.studySeries[studyUID].push(seriesKey);
      }
    },

    cacheImageSlice(state, { seriesKey, offset, asThumbnail, image }) {
      const key = imageCacheMultiKey(offset, asThumbnail);
      state.imageCache = {
        ...state.imageCache,
        [seriesKey]: {
          ...(state.imageCache[seriesKey] || {}),
          [key]: image,
        },
      };
    },

    cacheSeriesVolume(state, { seriesKey, image }) {
      state.volumeCache = {
        ...state.volumeCache,
        [seriesKey]: image,
      };
    },

    deleteSeriesVolume(state, seriesKey) {
      Vue.delete(state.volumeCache, seriesKey);
    },
  },

  actions: {
    async importFiles({ state, commit }, files) {
      const { dicomIO } = dependencies;

      if (files.length === 0) {
        return [];
      }

      const updatedSeriesInfo = await dicomIO.importFiles(files);
      const seriesUIDs = Object.keys(updatedSeriesInfo);
      const updatedSeriesKeys = []; // to be returned to caller
      for (let i = 0; i < seriesUIDs.length; i += 1) {
        const seriesUID = seriesUIDs[i];
        const info = updatedSeriesInfo[seriesUID];

        // TODO parse the raw string values
        const patient = {
          PatientID: info.PatientID || ANONYMOUS_PATIENT_ID,
          PatientName: info.PatientName || ANONYMOUS_PATIENT,
          ...pick(info, ['PatientBirthDate', 'PatientSex']),
        };
        const patientKey = genSynPatientKey(patient);
        const patientID = patient.PatientID;

        const studyKey = info.StudyInstanceUID;
        const studyUID = studyKey;
        const study = pick(info, [
          'StudyID',
          'StudyInstanceUID',
          'StudyDate',
          'StudyTime',
          'AccessionNumber',
          'Description',
        ]);

        const seriesKey = info.SeriesInstanceUID;
        const series = pick(info, [
          'Modality',
          'SeriesInstanceUID',
          'SeriesNumber',
          'SeriesDescription',
          // not standard dicom
          'NumberOfSlices',
          'ITKGDCMSeriesUID',
        ]);

        updatedSeriesKeys.push({
          patientKey,
          studyKey,
          seriesKey,
        });

        commit('addPatient', { patientKey, patient });
        commit('addStudy', { studyKey, study, patientID });
        commit('addSeries', { seriesKey, series, studyUID });

        // invalidate volume
        if (seriesKey in state.volumeCache) {
          commit('deleteSeriesVolume', seriesKey);
        }
      }
      return updatedSeriesKeys;
    },

    /**
     * Returns an ITK image for a single slice.
     *
     * seriesKey: the target series
     * slice: the slice offset to retrieve
     * asThumbnail: whether to cast image to unsigned char. Defaults to false.
     */
    async getSeriesImage(
      { commit, state },
      { seriesKey, slice, asThumbnail = false }
    ) {
      const { dicomIO } = dependencies;

      const cacheKey = imageCacheMultiKey(slice, asThumbnail);
      if (
        seriesKey in state.imageCache &&
        cacheKey in state.imageCache[seriesKey]
      ) {
        return state.imageCache[seriesKey][cacheKey];
      }

      if (!(seriesKey in state.seriesIndex)) {
        throw new Error(`Cannot find given series key: ${seriesKey}`);
      }
      const series = state.seriesIndex[seriesKey];
      const numSlices = series.NumberOfSlices;

      if (slice < 1 || slice > numSlices) {
        throw new Error(`Slice ${slice} is out of bounds`);
      }

      // we need to use the ITKGDCM-specific SeriesUID, since
      // that's what the internal dicom db indexes series on
      const uid = series.ITKGDCMSeriesUID;
      const itkImage = dicomIO.getSeriesImage(uid, slice, asThumbnail);

      commit('cacheImageSlice', {
        seriesKey,
        offset: slice,
        asThumbnail,
        image: itkImage,
      });

      return itkImage;
    },

    /**
     * Builds a series volume and returns it as a VTK image.
     *
     * Volumes may be invalidated if new files are imported
     * into the series.
     */
    async buildSeriesVolume({ state, commit }, seriesKey) {
      const { dicomIO } = dependencies;

      if (seriesKey in state.volumeCache) {
        return state.volumeCache[seriesKey];
      }

      if (!(seriesKey in state.seriesIndex)) {
        throw new Error(`Cannot find given series key: ${seriesKey}`);
      }

      const series = state.seriesIndex[seriesKey];
      const uid = series.ITKGDCMSeriesUID;
      const itkImage = await dicomIO.buildSeriesVolume(uid);

      const vtkImage = vtkITKHelper.convertItkToVtkImage(itkImage);

      commit('cacheSeriesVolume', {
        seriesKey,
        image: vtkImage,
      });

      return vtkImage;
    },
  },
});
