import { useImageCacheStore } from '@/src/store/image-cache';
import { watch } from 'vue';

type DeletionCallback = (deletedIDs: string[]) => void;

// One watcher per image-cache store instance (keyed so test pinias stay
// isolated): every registration shares a single key-set diff instead of each
// re-running it on every image add/delete.
const callbacksByStore = new WeakMap<object, Set<DeletionCallback>>();

// Reports image-cache deletions to the callback. Watches the key set because
// entries are deleted in place, which a watch on the object itself never sees.
// Sync flush so referencing stores clean up before `remove()` returns: a
// same-tick serialize() must not snapshot dangling IDs. Callbacks must not
// mutate the image cache.
export function onImageDeleted(callback: DeletionCallback) {
  const imageCacheStore = useImageCacheStore();

  let callbacks = callbacksByStore.get(imageCacheStore);
  if (!callbacks) {
    const registered = new Set<DeletionCallback>();
    callbacks = registered;
    callbacksByStore.set(imageCacheStore, registered);
    watch(
      () => Object.keys(imageCacheStore.imageById),
      (newIDs, oldIDs) => {
        const alive = new Set(newIDs);
        const deleted = (oldIDs ?? []).filter((id) => !alive.has(id));
        if (deleted.length) registered.forEach((cb) => cb(deleted));
      },
      { flush: 'sync' }
    );
  }
  callbacks.add(callback);
  return () => callbacks.delete(callback);
}
