import { useImageCacheStore } from '@/src/store/image-cache';
import { watch } from 'vue';

// Reports image-cache deletions to the callback (segment-group cascade,
// annotation-tool cleanup, view/crop/paint reference cleanup). Watches the key
// SET through a getter: the index is a reactive object whose entries are
// deleted in place, so a plain watch on its ref never fires (same object
// identity, no deep traversal) — the deletion diff has to come from the tracked
// key iteration.
//
// `flush: 'sync'` is deliberate: `datasetStore.remove` drops the image-cache
// entry, and a same-tick `serialize()` (applying a job "Open" result does
// exactly this) must not snapshot a dangling reference. A default ('pre')
// watcher runs a tick late, so the manifest would carry orphaned ids until the
// next tick. Sync flush makes every referencing store clean up BEFORE
// `remove()` returns. Safe: the callbacks (removeGroup / removeTool / view
// unbind / crop drop) never mutate the image cache, so this cannot re-enter.
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
