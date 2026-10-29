import { nextTick } from 'vue';
import { useImageCacheStore } from '@/src/store/image-cache';

/** Releases pending fixture reads, removes cached images, and awaits deferred VTK disposal. */
export async function cleanupCachedImages(pendingReads: (() => void)[]) {
  pendingReads.splice(0).forEach((release) => release());
  const cache = useImageCacheStore();
  [...cache.imageIds].forEach((id) => cache.removeImage(id));
  await nextTick();
}
