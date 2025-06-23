import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import { whenever } from '@vueuse/core';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  gaussianSmoothLabelMap,
  validateGaussianSmoothParams,
  type GaussianSmoothParams,
} from '@/src/core/tools/gaussianSmooth';
import { useSegmentGroupStore } from '../segmentGroups';

type StartState = {
  step: 'start';
};

type ComputingState = {
  step: 'computing';
  activeParentImageID: string | null;
};

type PreviewingState = {
  step: 'previewing';
  activeParentImageID: string | null;
  segImage: vtkLabelMap;
  originalScalars: TypedArray | number[];
};

type GaussianSmoothState = StartState | ComputingState | PreviewingState;

const DEFAULT_SIGMA = 1.0;
const MIN_SIGMA = 0.1;
const MAX_SIGMA = 5.0;

export const useGaussianSmoothStore = defineStore('gaussianSmooth', () => {
  const smoothState = ref<GaussianSmoothState>({ step: 'start' });
  const sigma = ref(DEFAULT_SIGMA);

  const smoothStep = computed(() => smoothState.value.step);

  function resetState() {
    smoothState.value = { step: 'start' };
  }

  const segmentGroupStore = useSegmentGroupStore();
  const paintStore = usePaintToolStore();
  const { activeSegmentGroupID } = storeToRefs(paintStore);
  const messageStore = useMessageStore();
  const { currentImageID } = useCurrentImage();

  function rollbackPreview(
    image: vtkLabelMap,
    originalScalars: TypedArray | number[]
  ): void {
    image.getPointData().getScalars().setData(originalScalars);
    image.modified();
  }

  function setSigma(value: number) {
    sigma.value = Math.max(MIN_SIGMA, Math.min(MAX_SIGMA, value));
  }

  async function computeGaussianSmooth(groupId: string) {
    const segImage = segmentGroupStore.dataIndex[groupId];
    const originalScalars = segImage.getPointData().getScalars().getData();

    smoothState.value = {
      step: 'computing',
      activeParentImageID: segmentGroupStore.metadataByID[groupId].parentImage,
    };

    if (!paintStore.activeSegment) {
      messageStore.addError('No active segment selected');
      resetState();
      return;
    }

    const params: GaussianSmoothParams = {
      sigma: sigma.value,
      label: paintStore.activeSegment,
    };

    // Validate parameters
    const validationError = validateGaussianSmoothParams(params);
    if (validationError) {
      messageStore.addError(`Invalid smoothing parameters: ${validationError}`);
      resetState();
      return;
    }

    try {
      // Apply Gaussian smoothing
      // Use setTimeout to allow UI to update and show computing state
      const outputScalars = await new Promise<TypedArray>((resolve, reject) => {
        setTimeout(() => {
          try {
            const result = gaussianSmoothLabelMap(segImage, params);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, 10);
      });

      // If the state changed during the async operation, stop processing
      if (smoothState.value.step !== 'computing') {
        return; // cancelSmooth handled the state change
      }

      const scalars = segImage.getPointData().getScalars();
      scalars.setData(outputScalars);
      segImage.modified();

      smoothState.value = {
        step: 'previewing',
        activeParentImageID:
          segmentGroupStore.metadataByID[groupId].parentImage,
        segImage,
        originalScalars,
      };
    } catch (error) {
      messageStore.addError(
        'Gaussian Smoothing Operation Failed',
        error as Error
      );
      if (smoothState.value.step === 'computing') {
        rollbackPreview(segImage, originalScalars);
        resetState();
      }
    }
  }

  function confirmSmooth() {
    resetState();
  }

  function cancelSmooth() {
    const state = smoothState.value;

    if (state.step === 'previewing') {
      rollbackPreview(state.segImage, state.originalScalars);
    }
    resetState();
  }

  // Cancel smooth when switching away from GaussianSmooth mode
  whenever(
    () => paintStore.activeMode !== PaintMode.GaussianSmooth,
    () => {
      cancelSmooth();
    }
  );

  // Cancel smooth when active segment group changes
  watch(activeSegmentGroupID, () => {
    cancelSmooth();
  });

  // Cancel smooth when current image changes
  watch(currentImageID, (newVal) => {
    const state = smoothState.value;
    if (
      (state.step === 'computing' || state.step === 'previewing') &&
      state.activeParentImageID !== newVal
    ) {
      cancelSmooth();
    }
  });

  return {
    smoothState,
    smoothStep,
    sigma,
    setSigma,
    computeGaussianSmooth,
    confirmSmooth,
    cancelSmooth,
    // Expose constants for UI
    MIN_SIGMA,
    MAX_SIGMA,
    DEFAULT_SIGMA,
  };
});
