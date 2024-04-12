import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { getDisplayName, useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useFileStore } from './datasets-files';
import { StateFile } from '../io/state-file/schema';
import { useErrorMessage } from '../composables/useErrorMessage';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

export const makeDICOMSelection = (volumeKey: string) =>
  ({
    type: 'dicom',
    volumeKey,
  } as const);

export type DICOMSelection = ReturnType<typeof makeDICOMSelection>;

export const makeImageSelection = (imageID: string) =>
  ({
    type: 'image',
    dataID: imageID,
  } as const);

export type ImageSelection = ReturnType<typeof makeImageSelection>;

export type DataSelection = DICOMSelection | ImageSelection;

export const getImageID = (selection: DataSelection) => {
  if (selection.type === 'image') return selection.dataID;
  if (selection.type === 'dicom') {
    // possibly undefined because image may not have been made yet
    return useDICOMStore().volumeToImageID[selection.volumeKey];
  }

  const _exhaustiveCheck: never = selection;
  throw new Error(`invalid selection type ${_exhaustiveCheck}`);
};

export const getImage = async (selection: DataSelection) => {
  const images = useImageStore();
  const dicoms = useDICOMStore();
  if (selection.type === 'dicom') {
    // ensure image data exists
    await useErrorMessage('Failed to build volume', () =>
      dicoms.buildVolume(selection.volumeKey)
    );
    return images.dataIndex[getImageID(selection)!];
  }
  // just an image that should be in dataIndex
  return images.dataIndex[selection.dataID];
};

// Converts imageID to VolumeKey if exists, else return input imageID
export const getDataID = (imageID: string) => {
  const dicomStore = useDICOMStore();
  return dicomStore.imageIDToVolumeKey[imageID] ?? imageID;
};

// @param id - VolumeKey or ImageID
export const getDataSelection = (id: string) => {
  const dicomStore = useDICOMStore();
  const volumeKey =
    dicomStore.imageIDToVolumeKey[id] ??
    (id in dicomStore.volumeInfo ? id : undefined);
  if (volumeKey) {
    return makeDICOMSelection(volumeKey);
  }
  return makeImageSelection(id);
};

// Pass VolumeKey or ImageID and get ImageID
export const findImageID = (dataID: string) => {
  const dicomStore = useDICOMStore();
  return dicomStore.volumeToImageID[dataID] ?? dataID;
};

export function selectionEquals(s1: DataSelection, s2: DataSelection) {
  if (s1.type === 'dicom' && s2.type === 'dicom') {
    return s1.volumeKey === s2.volumeKey;
  }
  if (s1.type === 'image' && s2.type === 'image') {
    return s1.dataID === s2.dataID;
  }
  return false;
}

const getImageName = (imageID: string) => {
  return useImageStore().metadata[imageID].name;
};

export const getSelectionName = (selection: DataSelection) => {
  if (selection.type === 'image') return getImageName(selection.dataID);
  if (selection.type === 'dicom') {
    const imageID = getImageID(selection);
    if (imageID) return getImageName(imageID);
    return getDisplayName(useDICOMStore().volumeInfo[selection.volumeKey]);
  }
  const _exhaustiveCheck: never = selection;
  throw new Error(`invalid selection type ${_exhaustiveCheck}`);
};

export const useDatasetStore = defineStore('dataset', () => {
  const imageStore = useImageStore();
  const dicomStore = useDICOMStore();
  const fileStore = useFileStore();

  // --- state --- //

  const primarySelection = ref<DataSelection | null>(null);

  // --- getters --- //

  const primaryImageID = computed(() => {
    if (primarySelection.value) return getImageID(primarySelection.value);
    return undefined;
  });

  const primaryDataset = computed<vtkImageData | null>(() => {
    const { dataIndex } = imageStore;
    return (primaryImageID.value && dataIndex[primaryImageID.value]) || null;
  });

  const selectees = computed(() => {
    const volumeKeys = Object.keys(dicomStore.volumeInfo);
    const images = imageStore.idList.filter(
      (id) => !(id in dicomStore.imageIDToVolumeKey)
    );
    return [...volumeKeys, ...images].map(getDataSelection);
  });

  // --- actions --- //

  function setPrimarySelection(sel: DataSelection | null) {
    primarySelection.value = sel;

    if (sel === null) {
      return;
    }

    // if selection is dicom, call buildVolume
    if (sel.type === 'dicom') {
      useErrorMessage('Failed to build volume', () =>
        dicomStore.buildVolume(sel.volumeKey)
      );
    }
  }

  async function serialize(stateFile: StateFile) {
    await dicomStore.serialize(stateFile);
    await imageStore.serialize(stateFile);

    if (primarySelection.value !== null) {
      let id = null;
      if (primarySelection.value.type === 'dicom') {
        id = primarySelection.value.volumeKey;
      } else {
        id = primarySelection.value.dataID;
      }

      const { manifest } = stateFile;
      manifest.primarySelection = id;
    }
  }

  // --- watch for deletion --- //

  imageStore.$onAction(({ name, args, after }) => {
    if (name !== 'deleteData') {
      return;
    }
    after(() => {
      const [id] = args;
      const sel = primarySelection.value;
      if (sel?.type === 'image' && sel.dataID === id) {
        primarySelection.value = null;
      }
      // remove file store entry
      fileStore.remove(id);

      const volumeKey = dicomStore.imageIDToVolumeKey[id];
      if (volumeKey) {
        delete dicomStore.volumeToImageID[volumeKey];
        delete dicomStore.imageIDToVolumeKey[id];
      }
    });
  });

  dicomStore.$onAction(({ name, args, after }) => {
    if (name !== 'deleteVolume') {
      return;
    }

    after(() => {
      const [volumeKey] = args;
      const sel = primarySelection.value;
      if (sel?.type === 'dicom' && volumeKey === sel.volumeKey) {
        primarySelection.value = null;
      }

      fileStore.remove(volumeKey);
    });
  });

  return {
    primaryImageID,
    primarySelection,
    primaryDataset,
    selectees,
    setPrimarySelection,
    serialize,
  };
});
