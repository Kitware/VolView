import { useImageCacheStore } from '@/src/store/image-cache';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

export function onImageDeleted(callback: (deletedIDs: string[]) => void) {
  const { imageById } = storeToRefs(useImageCacheStore());

  return watch(imageById, (newIndex, oldIndex) => {
    const deleted = Object.keys(oldIndex).filter((id) => !(id in newIndex));
    if (deleted.length) callback(deleted);
  });
}
