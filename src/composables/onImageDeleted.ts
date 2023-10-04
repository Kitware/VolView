import { useImageStore } from '@/src/store/datasets-images';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

export function onImageDeleted(callback: (deletedIDs: string[]) => void) {
  const { dataIndex } = storeToRefs(useImageStore());

  return watch(dataIndex, (newIndex, oldIndex) => {
    const deleted = Object.keys(oldIndex).filter((id) => !(id in newIndex));
    if (deleted.length) callback(deleted);
  });
}
