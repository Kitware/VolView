import { useImageStore } from '@/src/store/datasets-images';
import { Maybe } from '@/src/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { whenever } from '@vueuse/core';
import { computed, Ref, WatchCallback } from 'vue';

export function wheneverImageLoaded(
  imageId: Ref<Maybe<string>>,
  cb: WatchCallback<{ id: string; imageData: vtkImageData }>
) {
  const imageStore = useImageStore();
  const hasImageData = computed(() => {
    const id = imageId.value;
    if (!id) return false;
    return !!imageStore.dataIndex[id];
  });

  return whenever(hasImageData, (newVal, oldVal, onCleanup) => {
    cb(
      { id: imageId.value!, imageData: imageStore.dataIndex[imageId.value!] },
      undefined,
      onCleanup
    );
  });
}
