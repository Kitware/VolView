import { defineStore } from 'pinia';
import { ref } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';
import {
  gaussianSmoothLabelMap,
  type GaussianSmoothParams,
} from '@/src/core/tools/gaussianSmooth';

const DEFAULT_SIGMA = 1.0;
const MIN_SIGMA = 0.1;
const MAX_SIGMA = 5.0;

export const useGaussianSmoothStore = defineStore('gaussianSmooth', () => {
  const sigma = ref(DEFAULT_SIGMA);

  function setSigma(value: number) {
    sigma.value = Math.max(MIN_SIGMA, Math.min(MAX_SIGMA, value));
  }

  async function computeAlgorithm(
    segImage: vtkLabelMap,
    activeSegment: number
  ): Promise<TypedArray> {
    const params: GaussianSmoothParams = {
      sigma: sigma.value,
      label: activeSegment,
    };

    return gaussianSmoothLabelMap(segImage, params);
  }

  return {
    sigma,
    setSigma,
    computeAlgorithm,
    // Expose constants for UI
    MIN_SIGMA,
    MAX_SIGMA,
    DEFAULT_SIGMA,
  };
});
