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
import { useModelStore } from './datasets-models';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

export const useDatasetStore = defineStore('dataset', () => {
  const imageStore = useImageStore();
  const dicomStore = useDICOMStore();
  const fileStore = useFileStore();
  const layersStore = useLayersStore();
  const modelStore = useModelStore();

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

  async function serialize(stateFile: StateFile) {
    await dicomStore.serialize(stateFile);
    await imageStore.serialize(stateFile);

    if (primarySelection.value) {
      const { manifest } = stateFile;
      manifest.primarySelection = primarySelection.value;
    }
  }

  const remove = (id: string | null) => {
    if (!id) return;

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

  const removeAll = () => {
    // Create a copy to avoid iteration issue while removing data
    const imageIdCopy = [...imageStore.idList];
    imageIdCopy.forEach((id) => {
      remove(id);
    });

    const modelIdCopy = [...modelStore.idList];
    modelIdCopy.forEach((id) => {
      remove(id);
    });
  };

  return {
    primaryImageID,
    primarySelection,
    primaryDataset,
    idsAsSelections,
    setPrimarySelection,
    serialize,
    remove,
    removeAll,
  };
});
