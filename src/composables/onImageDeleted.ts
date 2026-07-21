import { useImageCacheStore } from '@/src/store/image-cache';
import { getCurrentScope, onScopeDispose } from 'vue';

type DeletionCallback = (deletedIDs: string[]) => void;

// Reports image-cache deletions synchronously so referencing stores clean up
// before `remove()` returns and a same-tick serialize cannot snapshot dangling
// IDs. The subscription is owned by the image-cache store; tying only this
// callback to the caller's scope means disposing one subscriber cannot stop
// every other store's cascade.
export function onImageDeleted(callback: DeletionCallback) {
  const unsubscribe = useImageCacheStore().onImageDeleted(callback);
  if (getCurrentScope()) onScopeDispose(unsubscribe);
  return unsubscribe;
}

// A store registering a cascade here should also declare the manifest
// references that cascade keeps clean — see `@/src/core/manifestRefs`.
