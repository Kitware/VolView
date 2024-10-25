import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  isDicomImage,
  isRegularImage,
  type DataSelection,
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

  const primaryImageID = primarySelection;

  const primaryDataset = computed<vtkImageData | null>(() => {
    const { dataIndex } = imageStore;
    return (primaryImageID.value && dataIndex[primaryImageID.value]) || null;
  });

  const idsAsSelections = computed(() => {
    const volumeKeys = Object.keys(dicomStore.volumeInfo);
    const images = imageStore.idList.filter((id) => isRegularImage(id));
    return [...volumeKeys, ...images];
  });

  // --- actions --- //

  function setPrimarySelection(sel: DataSelection | null) {
    primarySelection.value = sel;
    if (!sel) return;

    // if selection is dicom, call buildVolume
    if (isDicomImage(sel)) {
      useErrorMessage('Failed to build volume', () =>
        dicomStore.buildVolume(sel)
      );
    }
  }

  function changeNextImage() {
    if (!primaryImageID.value) return;

    const currentImageID = primaryImageID.value;
    const { idList } = imageStore;
    const maxIdx = idList.length - 1;

    let currentIdx = idList.indexOf(currentImageID);
    if (currentIdx >= maxIdx) {
      // Reset Idx to -1 as it will be increased later
      currentIdx = -1;
    }

    setPrimarySelection(idList[currentIdx + 1]);
  }

  function changePreviousImage() {
    if (!primaryImageID.value) return;

    const currentImageID = primaryImageID.value;
    const { idList } = imageStore;
    const maxIdx = idList.length - 1;

    let currentIdx = idList.indexOf(currentImageID);
    if (currentIdx <= 0) {
      currentIdx = maxIdx + 1;
    }

    setPrimarySelection(idList[currentIdx - 1]);
  }

  async function serialize(stateFile: StateFile) {
    await dicomStore.serialize(stateFile);
    await imageStore.serialize(stateFile);

    if (primarySelection.value) {
      const { manifest } = stateFile;
      manifest.primarySelection = primarySelection.value;
    }
  }

  const remove = (id: string) => {
    if (id === primarySelection.value) {
      primarySelection.value = null;
    }

    if (isDicomImage(id)) {
      dicomStore.deleteVolume(id);
    }
    imageStore.deleteData(id);

    fileStore.remove(id);
    layersStore.remove(id);
  };

  return {
    primaryImageID,
    primarySelection,
    primaryDataset,
    idsAsSelections,
    setPrimarySelection,
    changeNextImage,
    changePreviousImage,
    serialize,
    remove,
  };
});
