import dicom from './dicom';
import { FileTypes } from '../io/io';
import { isVtkObject } from '../utils/common';
import { renderRepresentationsOf, removeRepresentationsOf } from '../vtk/proxyUtils';

export const NO_SELECTION = -1;
export const NO_PROXY = -1;

export const DataTypes = {
  Image: 'Image',
  Dicom: 'DICOM',
  Model: 'Model',
};

function createVizPipelineFor(data, proxyManager) {
  let transformType = null;
  if (data.isA('vtkImageData')) {
    transformType = 'ImageTransform';
  } else if (data.isA('vtkPolyData')) {
    transformType = 'PolyDataTransform';
  } else {
    throw new Error('createVizPipelineFor: data is not image or geometry');
  }

  const dataSource = proxyManager.createProxy(
    'Sources',
    'TrivialProducer',
  );
  dataSource.setInputData(data);

  const transformFilter = proxyManager.createProxy(
    'Sources',
    transformType,
    {
      inputProxy: dataSource,
    },
  );

  return {
    dataSource,
    transformFilter,
  };
}

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
      selectedBaseImage: NO_SELECTION,
      // track the mapping from seriesUID to data ID
      dicomSeriesToID: {},

      baseMetadata: {
        spacing: [1, 1, 1],
        // identity
        worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },

      basePipeline: {
        sourcePID: NO_PROXY,
        transformFilterPID: NO_PROXY,
      },
      pipelines: {},
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

      selectBaseImage(state, id) {
        if (
          id in state.data.index
          && state.data.index[id].type === DataTypes.Image
        ) {
          state.selectedBaseImage = id;
        } else {
          state.selectedBaseImage = NO_SELECTION;
        }
      },

      setBasePipeline(state, { sourcePID, transformFilterPID }) {
        state.basePipeline.sourcePID = sourcePID;
        state.basePipeline.transformFilterPID = transformFilterPID;
      },

      setBaseMetadata(state, { spacing, worldToIndex }) {
        state.baseMetadata.spacing = [...spacing];
        state.baseMetadata.worldToIndex = [...worldToIndex];
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

      /**
       * Selects a base image.
       *
       * If the dataset is not an image or NO_SELECTION,
       * then the selection will be cleared.
       */
      async selectBaseImage({ state, dispatch, commit }, id) {
        commit('selectBaseImage', id);

        const baseID = state.selectedBaseImage;
        if (baseID !== NO_SELECTION) {
          if (!idToVtkData.has(baseID)) {
            if (state.data.index[baseID].type === DataTypes.Dicom) {
              const { seriesKey } = state.data.index[baseID];
              const imageData = await dispatch('dicom/buildVolume', seriesKey);
              idToVtkData.set(baseID, imageData);
            } else {
              throw new Error('updateRenderPipeline: no VTK data for selection');
            }
          }
          const imageData = idToVtkData.get(baseID);
          const spacing = imageData.getSpacing();
          const worldToIndex = imageData.getWorldToIndex();

          commit('setBaseMetadata', {
            spacing,
            worldToIndex,
          });
        }

        await dispatch('updateRenderPipeline');
      },

      /**
       * Updates the rendering pipeline.
       */
      async updateRenderPipeline({ state, commit }) {
        const { proxyManager } = dependencies;

        const baseID = state.selectedBaseImage;
        if (baseID !== NO_SELECTION) {
          const imageData = idToVtkData.get(baseID);

          if (state.basePipeline.sourcePID === NO_PROXY) {
            const { dataSource, transformFilter } = createVizPipelineFor(
              imageData,
              proxyManager,
            );
            commit('setBasePipeline', {
              sourcePID: dataSource.getProxyId(),
              transformFilterPID: transformFilter.getProxyId(),
            });
          }

          const { sourcePID, transformFilterPID } = state.basePipeline;
          const source = proxyManager.getProxyById(sourcePID);
          const transformFilter = proxyManager.getProxyById(transformFilterPID);

          source.setInputData(imageData);
          transformFilter.setTransform(imageData.getWorldToIndex());
          renderRepresentationsOf(transformFilter, proxyManager);

          // TODO update all other layers

          proxyManager.renderAllViews();
        } else if (state.basePipeline.sourcePID !== NO_PROXY) {
          // detach representations
          const { transformFilterPID } = state.basePipeline;
          const transformFilter = proxyManager.getProxyById(transformFilterPID);
          removeRepresentationsOf(transformFilter, proxyManager);
        }
      },
    },
  };
};
