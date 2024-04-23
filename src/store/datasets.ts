import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  DataSelection,
  getDataSelection,
  getImageID,
  selectionEquals,
} from '@/src/utils/dataSelection';
import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useFileStore } from './datasets-files';
import { StateFile } from '../io/state-file/schema';
import { useErrorMessage } from '../composables/useErrorMessage';
import { useLayersStore } from './datasets-layers';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

export const useDatasetStore = defineStore('dataset', () => {
  const imageStore = useImageStore();
  const dicomStore = useDICOMStore();
  const fileStore = useFileStore();
  const layersStore = useLayersStore();

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

  const idsAsSelections = computed(() => {
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

  const remove = (id: string) => {
    const sel = getDataSelection(id);
    if (
      primarySelection.value &&
      selectionEquals(sel, primarySelection.value)
    ) {
      primarySelection.value = null;
    }

    if (sel.type === 'dicom') {
      if (sel.volumeKey in dicomStore.volumeToImageID) {
        imageStore.deleteData(dicomStore.volumeToImageID[sel.volumeKey]);
      }
      dicomStore.deleteVolume(sel.volumeKey);
    } else if (sel.type === 'image') {
      imageStore.deleteData(id);
    }

    fileStore.remove(id);
    layersStore.remove(sel);
  };

  return {
    primaryImageID,
    primarySelection,
    primaryDataset,
    idsAsSelections,
    setPrimarySelection,
    serialize,
    remove,
  };
});
