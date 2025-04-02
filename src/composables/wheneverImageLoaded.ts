import { useImageCacheStore } from '@/src/store/image-cache';
import { Maybe } from '@/src/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { whenever } from '@vueuse/core';
import { computed, MaybeRef, unref, WatchCallback } from 'vue';

export function wheneverImageLoaded(
  imageId: MaybeRef<Maybe<string>>,
  cb: WatchCallback<{ id: string; imageData: vtkImageData }>
) {
  const imageCacheStore = useImageCacheStore();
  const image = computed(() => {
    const id = unref(imageId);
    if (!id) return null;
    return imageCacheStore.imageById[id];
  });
  const imageIsLoaded = computed(() => image.value?.loaded.value ?? false);
  return whenever(imageIsLoaded, (newVal, oldVal, onCleanup) => {
    cb(
      { id: unref(imageId)!, imageData: image.value!.getVtkImageData() },
      undefined,
      onCleanup
    );
  });
}
