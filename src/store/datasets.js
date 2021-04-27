import Vue from 'vue';
import { isVtkObject } from 'vtk.js/Sources/macro';

import { DataTypes, NO_SELECTION } from '@/src/constants';
import { removeFromArray } from '@/src/utils/common';

import { FileTypes } from '../io/io';

function addImageOfType(state, { name, image, type }) {
  const id = state.data.nextID;
  state.data.vtkCache[id] = image;
  if (type === DataTypes.Image) {
    state.data.imageIDs.push(id);
  } else if (type === DataTypes.Labelmap) {
    state.data.labelmapIDs.push(id);
  }
  state.data.index = {
    ...state.data.index,
    [id]: {
      type,
      name,
      dims: image.getDimensions(),
      spacing: image.getSpacing(),
    },
  };
  state.data.nextID += 1;
}

export const mutations = {
  /**
   * Args: { image, name }
   */
  addImage(state, { name, image }) {
    addImageOfType(state, { name, image, type: DataTypes.Image });
  },

  /**
   * Args: { image, name }
   */
  addLabelmap(state, { name, image }) {
    addImageOfType(state, { name, image, type: DataTypes.Labelmap });
  },

  /**
   * Args: { image, name }
   */
  addModel(state, { name, model }) {
    const id = state.data.nextID;
    state.data.vtkCache[id] = model;
    state.data.modelIDs.push(id);
    state.data.index = {
      ...state.data.index,
      [id]: {
        type: DataTypes.Model,
        name,
      },
    };
    state.data.nextID += 1;
  },

  /**
   * Args: { patientKey, studyKey, volumeKey }
   */
  addDicom(state, { patientKey, studyKey, volumeKey }) {
    const id = state.data.nextID;
    state.data.nextID += 1;
    // save volumeKey -> id mapping
    state.dicomVolumeToDataID = {
      ...state.dicomVolumeToDataID,
      [volumeKey]: id,
    };
    state.data.dicomIDs.push(id);
    state.data.index = {
      ...state.data.index,
      [id]: {
        type: DataTypes.Dicom,
        patientKey,
        studyKey,
        volumeKey,
      },
    };
  },

  associateData(state, { parentID, childID }) {
    const { parentOf, childrenOf } = state.dataAssoc;
    if (!(parentID in childrenOf)) {
      Vue.set(childrenOf, parentID, []);
    }
    childrenOf[parentID].push(childID);
    Vue.set(parentOf, childID, parentID);
  },

  removeData(state, dataID) {
    if (dataID in state.data.index) {
      const { data, dataAssoc } = state;
      const { parentOf, childrenOf } = dataAssoc;

      if (dataID in parentOf) {
        // child association
        const parentID = parentOf[dataID];
        const idx = childrenOf[parentID].indexOf(dataID);
        childrenOf[parentID].splice(idx, 1);
        Vue.delete(parentOf, dataID);
      } else if (dataID in childrenOf) {
        // parent association
        Vue.delete(childrenOf, dataID);
      }

      const { type } = data.index[dataID];
      if (type === DataTypes.Image) {
        removeFromArray(data.imageIDs, dataID);
      } else if (type === DataTypes.Labelmap) {
        removeFromArray(data.labelmapIDs, dataID);
      } else if (type === DataTypes.Model) {
        removeFromArray(data.modelIDs, dataID);
      } else if (type === DataTypes.Dicom) {
        removeFromArray(data.dicomIDs, dataID);
        const { volumeKey } = state.data.index[dataID];
        Vue.delete(state.dicomVolumeToDataID, volumeKey);
      }

      Vue.delete(data.index, dataID);
      Vue.delete(data.vtkCache, dataID);
    }
  },

  setBaseImage(state, id) {
    state.selectedBaseImage = id;
  },

  cacheDicomImage(state, { volumeKey, image }) {
    const id = state.dicomVolumeToDataID[volumeKey];
    state.data.vtkCache[id] = image;
  },
};

export const makeActions = (dependencies) => ({
  /**
   * Loads a list of File objects.
   *
   * @async
   * @param {File[]} files
   */
  async loadFiles({ dispatch }, files) {
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

    const errors = await Promise.all([
      dispatch('loadDicomFiles', dicomFiles),
      dispatch('loadRegularFiles', regularFiles),
    ]);

    return [].concat(...errors);
  },

  async loadDicomFiles({ state, commit, dispatch }, files) {
    const errors = [];
    try {
      const updatedVolumeKeys = await dispatch('dicom/importFiles', files);
      updatedVolumeKeys.forEach((keys) => {
        if (!(keys.volumeKey in state.dicomVolumeToDataID)) {
          commit('addDicom', {
            patientKey: keys.patientKey,
            studyKey: keys.studyKey,
            volumeKey: keys.volumeKey,
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

  async loadRegularFiles({ commit }, files) {
    const { fileIO } = dependencies;

    const loadResults = await Promise.allSettled(
      files.map((f) => fileIO.readSingleFile(f))
    );

    const errors = [];
    loadResults.forEach((r, i) => {
      switch (r.status) {
        case 'fulfilled': {
          const obj = r.value;
          const { name } = files[i];
          if (isVtkObject(obj)) {
            if (obj.isA('vtkImageData')) {
              commit('addImage', {
                name,
                image: obj,
              });
            } else if (obj.isA('vtkPolyData')) {
              commit('addModel', {
                name,
                model: obj,
              });
            }
          } else {
            errors.push({
              name,
              error: new Error(
                'loadRegularFiles: Read file is not a VTK object'
              ),
            });
          }
          break;
        }

        case 'rejected':
          errors.push({
            name: files[i].name,
            error: r.reason,
          });
          break;

        default:
          errors.push({
            name: files[i].name,
            error: new Error('loadRegularFiles: Invalid allSettled state'),
          });
      }
    });

    return errors;
  },

  /**
   * Selects a base image.
   *
   * If the dataset is not an image or NO_SELECTION,
   * then the selection will be cleared.
   */
  async selectBaseImage({ state, commit, dispatch }, id) {
    let baseImageId = NO_SELECTION;
    if (
      id in state.data.index &&
      (state.data.index[id].type === DataTypes.Image ||
        state.data.index[id].type === DataTypes.Dicom)
    ) {
      baseImageId = id;
    }

    // special case: load dicom image
    if (baseImageId !== NO_SELECTION) {
      const dataInfo = state.data.index[baseImageId];
      if (!(baseImageId in state.data.vtkCache)) {
        switch (dataInfo.type) {
          case DataTypes.Dicom: {
            const { volumeKey } = dataInfo;
            const image = await dispatch('dicom/buildVolume', volumeKey);
            commit('cacheDicomImage', { volumeKey, image });
            break;
          }
          default:
            throw new Error(
              `selectBaseImage: Item ${baseImageId} has no vtk data`
            );
        }
      }
    }

    commit('setBaseImage', baseImageId);
  },

  async removeData({ commit, dispatch, state }, dataID) {
    if (dataID === state.selectedBaseImage) {
      await dispatch('widgets/deactivateActiveWidget');
      commit('setBaseImage', NO_SELECTION);
    }

    const info = state.data.index[dataID];
    if (info?.type === DataTypes.Dicom) {
      const { volumeKey } = info;
      await dispatch('dicom/removeData', volumeKey);
    }

    await dispatch('visualization/removeData', dataID);
    await dispatch('annotations/removeData', dataID);

    // parent association condition
    const { childrenOf } = state.dataAssoc;
    if (dataID in childrenOf) {
      const children = childrenOf[dataID];
      await Promise.all(children.map((id) => dispatch('removeData', id)));
    }

    commit('removeData', dataID);
  },
});
