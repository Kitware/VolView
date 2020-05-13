import dicom from './dicom';
import { FileTypes } from '../io/io';
import { FileLoaded, Data } from '../types';

export const NO_SELECTION = -1;

export default (dependencies) => {
  let idCounter = 0;
  const nextID = () => {
    idCounter += 1;
    return idCounter;
  };

  return {
    namespaced: true,

    modules: {
      dicom: dicom(dependencies),
    },

    state: {
      datasets: {},
      datasetOrder: [],
      selDataset: NO_SELECTION,
      // track the mapping from seriesUID to data ID
      seriesToDataID: {},
    },

    mutations: {
      addData(state, data) {
        const id = Data.mapId(data, (i) => i);
        if (!(id in state.datasets)) {
          state.datasetOrder.push(id);
          state.datasets[id] = data;
        }
      },
    },

    actions: {

      /**
       * Loads a list of File objects.
       *
       * @async
       * @param {File[]} files
       */
      async loadFiles({ state, commit, dispatch }, files) {
        const { fileIO } = dependencies;

        const dicomFiles = [];
        const regularFiles = [];

        const fileTypesP = files.map(async (file) => fileIO.getFileType(file));
        const fileTypes = await Promise.all(fileTypesP);
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const type = fileTypes[i];
          if (type === FileTypes.DICOM) {
            dicomFiles.push(file);
          } else {
            regularFiles.push(file);
          }
        }

        const dicomFilesPromise = dispatch('dicom/importFiles', dicomFiles);

        const regularFilesPromise = Promise.allSettled(
          regularFiles.map((f) => fileIO.readSingleFile(f)),
        );

        const regularFilesLoaded = (await regularFilesPromise).map((r, i) => {
          switch (r.status) {
            case 'fulfilled':
              commit('addData', Data.VtkData(nextID(), r.value));
              return FileLoaded.Success(regularFiles[i].name, r.value);

            case 'rejected':
              return FileLoaded.Failure(regularFiles[i].name, r.reason);

            default:
              return FileLoaded.Failure(
                regularFiles[i],
                new Error('loadFiles: Entered invalid state'),
              );
          }
        });

        let dicomFilesResult = null;
        try {
          const updatedSeriesKeys = await dicomFilesPromise;
          updatedSeriesKeys.forEach((keys) => {
            if (!(keys.seriesKey in state.seriesToDataID)) {
              const dataID = nextID();
              const data = Data.DicomSeriesData(
                dataID,
                keys.patientKey,
                keys.studyKey,
                keys.seriesKey,
              );
              commit('addData', data);
            }
          });
          dicomFilesResult = FileLoaded.Success('DICOM', true);
        } catch (e) {
          dicomFilesResult = FileLoaded.Failure('DICOM', e);
        }

        return {
          fileResults: regularFilesLoaded,
          dicomResult: dicomFilesResult,
        };
      },
    },
  };
};
