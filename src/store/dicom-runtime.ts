import { defineStore } from 'pinia';
import { markRaw, onScopeDispose } from 'vue';
import { createDicomRuntime } from '@/packages/dicom/core/runtime/createDicomRuntime';
import { $fetch } from '@/src/utils/fetch';
import itkConfig from '@/src/io/itk/itkConfig';

/** Each application instance owns its metadata workers, decoders and requests. */
export const useDicomRuntimeStore = defineStore('dicom-runtime', () => {
  const runtime = markRaw(
    createDicomRuntime({
      fetch: $fetch,
      assets: {
        pipelineWorkerUrl: itkConfig.pipelineWorkerUrl,
        imageIOUrl: itkConfig.imageIOUrl,
      },
      imageImportPolicy: 'skip-radiotherapy',
    })
  );
  onScopeDispose(() => runtime.dispose());
  return { runtime };
});
