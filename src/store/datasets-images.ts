import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { vtkImageData } from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useIdStore } from '@/src/store/id';
import { useImageCacheStore } from '@/src/store/image-cache';
import { ImageMetadata } from '../types/image';
import { compareImageSpaces } from '../utils/imageSpace';

/**
 * Stores regular non-dicom images (typically nrrd, mha, nii, etc.).
 */
export const useImageStore = defineStore('images', () => {
  const imageCacheStore = useImageCacheStore();

  const idList = ref<string[]>([]);

  const dataIndex = computed(() => {
    return Object.fromEntries<vtkImageData>(
      idList.value.map((id) => {
        return [id, imageCacheStore.getVtkImageData(id)!];
      })
    );
  });

  const metadata = computed(() => {
    return Object.fromEntries<ImageMetadata>(
      idList.value.map((id) => {
        return [id, imageCacheStore.getImageMetadata(id)!];
      })
    );
  });

  function addVTKImageData(
    name: string,
    imageData: vtkImageData,
    options: { id?: string } = {}
  ) {
    if (options.id && idList.value.includes(options.id)) {
      throw new Error('ID already exists');
    }

    const id = options.id ?? useIdStore().nextId();
    idList.value.push(id);

    return useImageCacheStore().addVTKImageData(imageData, name, { id });
  }

  function deleteData(id: string) {
    useImageCacheStore().removeImage(id);
  }

  function checkAllImagesSameSpace() {
    if (idList.value.length < 2) return false;

    const dataFirst = dataIndex.value[idList.value[0]];
    const allEqual = idList.value.slice(1).every((id) => {
      return compareImageSpaces(dataIndex.value[id], dataFirst);
    });

    return allEqual;
  }

  return {
    idList,
    dataIndex,
    metadata,
    addVTKImageData,
    deleteData,
    checkAllImagesSameSpace,
  };
});
