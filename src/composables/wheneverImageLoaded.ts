import { useImageCacheStore } from '@/src/store/image-cache';
import { Maybe } from '@/src/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { computed, MaybeRef, unref, WatchCallback, watch } from 'vue';

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
  return watch(
    [() => unref(imageId), imageIsLoaded],
    ([id, loaded], _, onCleanup) => {
      if (loaded && id) {
        cb(
          { id, imageData: image.value!.getVtkImageData() },
          undefined,
          onCleanup
        );
      }
    }
  );
}
