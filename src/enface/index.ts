import { defineAsyncComponent } from 'vue';

export const EnFaceViewer = defineAsyncComponent(
  () => import('@/src/enface/EnFaceViewer.vue')
);
export { getEnFaceAvailability } from '@/src/enface/availability';
export { useEnFaceViewStore } from '@/src/enface/store';
export { default as EnFaceControlPanel } from '@/src/enface/EnFaceControlPanel.vue';
export { augmentOCTMetadata } from '@/src/enface/dicomMetadata';
