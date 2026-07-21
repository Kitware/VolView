import { useImageCacheStore } from '@/src/store/image-cache';
import { watch } from 'vue';

// Reports image-cache deletions to the callback. Watches the key set because
// entries are deleted in place, which a watch on the object itself never sees.
// Sync flush so referencing stores clean up before `remove()` returns: a
// same-tick serialize() must not snapshot dangling IDs. Callbacks must not
// mutate the image cache.
export function onImageDeleted(callback: (deletedIDs: string[]) => void) {
  const imageCacheStore = useImageCacheStore();

  return watch(
    () => Object.keys(imageCacheStore.imageById),
    (newIDs, oldIDs) => {
      const alive = new Set(newIDs);
      const deleted = (oldIDs ?? []).filter((id) => !alive.has(id));
      if (deleted.length) callback(deleted);
    },
    { flush: 'sync' }
  );
}
