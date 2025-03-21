import { Ref, watch, WatchCallback, computed } from 'vue';
import { useImageStore } from '@/src/store/datasets-images';
import { Maybe } from '@/src/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

export function wheneverImageLoaded(
  imageId: Ref<Maybe<string>>,
  cb: WatchCallback<{ id: string; imageData: vtkImageData }>
) {
  const imageStore = useImageStore();
  const loadedIDs = new Set<string>();

  const watched = computed(() => {
    const id = imageId.value;
    return {
      id,
      imageData: id ? imageStore.dataIndex[id] : undefined,
    };
  });

  watch(
    watched,
    (newVal, oldVal, onCleanup) => {
      const { id, imageData } = newVal;
      if (id && imageData && !loadedIDs.has(id)) {
        loadedIDs.add(id);
        cb(
          { id, imageData },
          oldVal && oldVal.imageData
            ? { id: oldVal.id!, imageData: oldVal.imageData }
            : undefined,
          onCleanup
        );
      }
    },
    { immediate: true }
  );
}
