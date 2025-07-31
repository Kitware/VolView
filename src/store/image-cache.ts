import {
  LoadedVtkImage,
  ProgressiveImage,
  ProgressiveImageStatus,
} from '@/src/core/progressiveImage';
import { useIdStore } from '@/src/store/id';
import { Maybe } from '@/src/types';
import { ImageMetadata } from '@/src/types/image';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { markRaw, reactive, ref } from 'vue';

/**
 * An internal cache of progressively loadable images.
 */
export const useImageCacheStore = defineStore('image-cache', () => {
  const idStore = useIdStore();

  const imageIds = ref<string[]>([]);
  const imageById = reactive<Record<string, ProgressiveImage>>({});
  const imageStatus = reactive<Record<string, 'complete' | 'incomplete'>>({});
  const imageLoading = reactive<Record<string, boolean>>({});
  const imageErrors = reactive<Record<string, Error[]>>({});
  const imageListenerCleanup: Record<string, () => void> = {};

  function getVtkImageData(id: Maybe<string>): Maybe<vtkImageData> {
    if (!id) return null;
    return imageById[id]?.getVtkImageData() ?? null;
  }

  function getImageMetadata(id: Maybe<string>): Maybe<ImageMetadata> {
    if (!id) return null;
    return imageById[id]?.getImageMetadata() ?? null;
  }

  function registerListeners(id: string) {
    const data = imageById[id];
    const onStatus = (status: ProgressiveImageStatus) => {
      imageStatus[id] = status;
    };
    const onLoading = (loading: boolean) => {
      imageLoading[id] = loading;
    };
    const onError = (error: Error) => {
      imageErrors[id] ??= [];
      imageErrors[id].push(error);
    };

    imageListenerCleanup[id] = () => {
      data.removeEventListener('status', onStatus);
      data.removeEventListener('loading', onLoading);
      data.removeEventListener('error', onError);
    };

    data.addEventListener('status', onStatus);
    data.addEventListener('loading', onLoading);
    data.addEventListener('error', onError);
  }

  function unregisterListeners(id: string) {
    imageListenerCleanup[id]?.();
    delete imageListenerCleanup[id];
  }

  /**
   * Adds a progressive image.
   *
   * If an ID is provided and the ID already exists,
   * the image is assumed to be the same.
   * @param data
   * @param options
   * @returns
   */
  function addProgressiveImage(
    data: ProgressiveImage,
    options: { id?: string } = {}
  ): string {
    const id = options.id ?? idStore.nextId();
    if (id in imageById) return id;

    imageById[id] = markRaw(data);
    imageStatus[id] = data.getStatus();
    imageLoading[id] = data.isLoading();
    imageIds.value.push(id);

    registerListeners(id);
    data.startLoad();
    return id;
  }

  function addVTKImageData(
    imageData: vtkImageData,
    name: string,
    options: { id?: string } = {}
  ) {
    return addProgressiveImage(new LoadedVtkImage(imageData, name), options);
  }

  function removeImage(id: string) {
    if (!(id in imageById)) return;
    unregisterListeners(id);

    const idx = imageIds.value.indexOf(id);
    if (idx > -1) imageIds.value.splice(idx, 1);
    delete imageById[id];
    delete imageStatus[id];
    delete imageLoading[id];
  }

  return {
    imageIds,
    imageById,
    imageStatus,
    imageLoading,
    imageErrors,
    getVtkImageData,
    getImageMetadata,
    addProgressiveImage,
    addVTKImageData,
    removeImage,
  };
});
