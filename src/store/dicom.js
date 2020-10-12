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
 * This key is used to try to uniquely identify a patient, since the PatientID
 * is not guaranteed to be unique (especially in the anonymous case).
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
    // patientKey is generated from genSynPatientKey
    patientIndex: {}, // patientKey -> Patient
    patientStudies: {}, // patientKey -> [studyKey]

    // studyKey/studyUID is the StudyInstanceUID
    studyIndex: {}, // studyKey -> Study
    studySeries: {}, // studyUID -> [seriesKey]

    // seriesKey/seriesUID is the SeriesInstanceUID
    seriesIndex: {}, // seriesKey -> Series

    // help derive keys of parent objects in the hierarchy
    seriesParent: {}, // seriesKey -> { studyKey }
    studyParent: {}, // studyKey -> { patientKey }

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

    addStudy(state, { studyKey, study, patientKey }) {
      if (!(studyKey in state.studyIndex)) {
        state.studyIndex = {
          ...state.studyIndex,
          [studyKey]: study,
        };
        state.studyParent = {
          ...state.studyParent,
          [studyKey]: patientKey,
        };
        state.studyIndex[studyKey] = study;
        state.patientStudies[patientKey] =
          state.patientStudies[patientKey] ?? [];
        state.patientStudies[patientKey].push(studyKey);
      }
    },

    addSeries(state, { seriesKey, series, studyKey }) {
      if (!(seriesKey in state.seriesIndex)) {
        state.seriesIndex = {
          ...state.seriesIndex,
          [seriesKey]: series,
        };
        state.seriesParent = {
          ...state.seriesParent,
          [seriesKey]: studyKey,
        };
        state.studySeries[studyKey] = state.studySeries[studyKey] ?? [];
        state.studySeries[studyKey].push(seriesKey);
      }
    },

    removeSeries(state, seriesKey) {
      if (seriesKey in state.seriesIndex) {
        const studyKey = state.seriesParent[seriesKey];
        const idx = state.studySeries[studyKey].indexOf(seriesKey);
        if (idx > -1) {
          state.studySeries[studyKey].splice(idx, 1);
          Vue.delete(state.seriesParent, seriesKey);
          Vue.delete(state.seriesIndex, seriesKey);
        }
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

      const updatedSeries = await dicomIO.importFiles(files);
      const updatedSeriesKeys = []; // to be returned to caller

      await Promise.all(
        updatedSeries.map(async (gdcmSeriesUID) => {
          const numberOfSlices = await dicomIO.buildSeriesOrder(gdcmSeriesUID);
          let seriesKey;

          if (gdcmSeriesUID in state.seriesIndex) {
            seriesKey = state.seriesIndex[gdcmSeriesUID].SeriesInstanceUID;
          } else {
            const info = await dicomIO.readSeriesTags(gdcmSeriesUID, [
              { name: 'PatientName', tag: '0010|0010', strconv: true },
              { name: 'PatientID', tag: '0010|0020', strconv: true },
              { name: 'PatientBirthDate', tag: '0010|0030' },
              { name: 'PatientSex', tag: '0010|0040' },
              { name: 'StudyInstanceUID', tag: '0020|000d' },
              { name: 'StudyDate', tag: '0008|0020' },
              { name: 'StudyTime', tag: '0008|0030' },
              { name: 'StudyID', tag: '0020|0010', strconv: true },
              { name: 'AccessionNumber', tag: '0008|0050' },
              { name: 'StudyDescription', tag: '0008|1030', strconv: true },
              { name: 'Modality', tag: '0008|0060' },
              { name: 'SeriesInstanceUID', tag: '0020|000e' },
              { name: 'SeriesNumber', tag: '0020|0011' },
              { name: 'SeriesDescription', tag: '0008|103e', strconv: true },
            ]);

            Object.assign(info, {
              NumberOfSlices: numberOfSlices,
              ITKGDCMSeriesUID: gdcmSeriesUID,
            });

            // TODO parse the raw string values
            const patient = {
              PatientID: info.PatientID || ANONYMOUS_PATIENT_ID,
              PatientName: info.PatientName || ANONYMOUS_PATIENT,
              ...pick(info, ['PatientBirthDate', 'PatientSex']),
            };
            const patientKey = genSynPatientKey(patient);

            const studyKey = info.StudyInstanceUID;
            const study = pick(info, [
              'StudyID',
              'StudyInstanceUID',
              'StudyDate',
              'StudyTime',
              'AccessionNumber',
              'StudyDescription',
            ]);

            seriesKey = info.SeriesInstanceUID;
            const series = pick(info, [
              'Modality',
              'SeriesInstanceUID',
              'SeriesNumber',
              'SeriesDescription',
              // not dicom tags
              'NumberOfSlices',
              'ITKGDCMSeriesUID',
            ]);

            updatedSeriesKeys.push({
              patientKey,
              studyKey,
              seriesKey,
            });

            commit('addPatient', { patientKey, patient });
            commit('addStudy', { studyKey, study, patientKey });
            commit('addSeries', { seriesKey, series, studyKey });
          }

          // invalidate existing volume
          if (seriesKey in state.volumeCache) {
            commit('deleteSeriesVolume', seriesKey);
          }
        })
      );
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

    async removeData({ commit }, seriesKey) {
      const { dicomIO } = dependencies;
      await dicomIO.deleteSeries(seriesKey);
      commit('deleteSeriesVolume', seriesKey);
      commit('removeSeries', seriesKey);
    },
  },
});
