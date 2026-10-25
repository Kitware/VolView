import { defineStore } from 'pinia';
import { markRaw, onScopeDispose } from 'vue';
import { createDicomLoader } from '@/packages/dicom/core';
import { $fetch } from '@/src/utils/fetch';
import itkConfig from '@/src/io/itk/itkConfig';

/** Each application instance owns its metadata workers, decoder and requests. */
export const useDicomRuntimeStore = defineStore('dicom-runtime', () => {
  const loader = markRaw(
    createDicomLoader({
      fetch: $fetch,
      assets: {
        pipelineWorkerUrl: itkConfig.pipelineWorkerUrl,
        imageIOUrl: itkConfig.imageIOUrl,
      },
      imageImportPolicy: 'skip-radiotherapy',
    })
  );
  onScopeDispose(() => loader.dispose());
  return { loader };
});
