import { defineStore } from 'pinia';
import { markRaw, onScopeDispose } from 'vue';
import { createDicomRuntime } from '@/src/dicom/core/runtime/createDicomRuntime';
import { $fetch } from '@/src/utils/fetch';

/** Each application instance owns its metadata workers, decoders and requests. */
export const useDicomRuntimeStore = defineStore('dicom-runtime', () => {
  const runtime = markRaw(createDicomRuntime({ fetch: $fetch }));
  onScopeDispose(() => runtime.dispose());
  return { runtime };
});
