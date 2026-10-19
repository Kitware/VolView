import { defineAsyncComponent } from 'vue';

export const EnFaceViewer = defineAsyncComponent(
  () => import('@/src/oct/EnFaceViewer.vue')
);
export { getOCTAvailability } from '@/src/oct/availability';
export { useOCTViewStore } from '@/src/oct/store';
export { augmentOCTMetadata } from '@/src/oct/dicomMetadata';
