import dicom from './dicom';
import { FileTypes } from '../io/io';
import { isVtkObject } from '../utils/common';

export const NO_SELECTION = -1;

export const DataTypes = {
  Image: 'Image',
  Dicom: 'DICOM',
  Model: 'Model',
};

export default (dependencies) => {
  let idCounter = 0;
  const nextID = () => {
    idCounter += 1;
    return idCounter;
  };

  // used to avoid making the entire vtk object reactive
  const idToVtkData = new Map();

  return {
    namespaced: true,

    modules: {
      dicom: dicom(dependencies),
    },

    state: {
      data: {
        index: {},
        imageIDs: [],
        dicomIDs: [],
      },
      // track the mapping from seriesUID to data ID
      dicomSeriesToID: {},
    },

    mutations: {
      /**
       * Args: { id, imageData, name }
       */
      addImage(state, { id, name, imageData }) {
        if (!(id in state.data.index)) {
          idToVtkData.set(id, imageData);
          state.data.index[id] = {
            type: DataTypes.Image,
            name,
          };
          state.data.imageIDs.push(id);
        }
      },

      /**
       * Args: { id, patientKey, studyKey, seriesKey }
       */
      addDicom(state, { id, ...props }) {
        if (!(id in state.data.index)) {
          state.data.index[id] = {
            type: DataTypes.Dicom,
            patientKey: props.patientKey,
            studyKey: props.studyKey,
            seriesKey: props.seriesKey,
          };
          state.data.dicomIDs.push(id);
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
        const errors = [];

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

        const regularFilesLoadResults = await Promise.allSettled(
          regularFiles.map((f) => fileIO.readSingleFile(f)),
        );

        regularFilesLoadResults.forEach((r, i) => {
          switch (r.status) {
            case 'fulfilled': {
              const obj = r.value;
              const { name } = regularFiles[i];
              if (isVtkObject(obj)) {
                if (obj.isA('vtkImageData')) {
                  commit('addImage', {
                    id: nextID(),
                    name,
                    imageData: obj,
                  });
                }
              } else {
                errors.push({
                  name,
                  error: new Error('loadFiles: Read file is not a VTK object'),
                });
              }
              break;
            }

            case 'rejected':
              errors.push({
                name: regularFiles[i].name,
                error: r.reason,
              });
              break;

            default:
              errors.push({
                name: regularFiles[i].name,
                error: new Error('loadFiles: Invalid allSettled state'),
              });
          }
        });

        try {
          const updatedSeriesKeys = await dicomFilesPromise;
          updatedSeriesKeys.forEach((keys) => {
            if (!(keys.seriesKey in state.dicomSeriesToID)) {
              commit('addDicom', {
                id: nextID(),
                patientKey: keys.patientKey,
                studyKey: keys.studyKey,
                seriesKey: keys.seriesKey,
              });
            }
          });
        } catch (e) {
          errors.push({
            name: 'DICOM files',
            error: e,
          });
        }

        return errors;
      },
    },
  };
};
