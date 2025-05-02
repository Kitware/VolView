import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { morphologicalContourInterpolation } from '@itk-wasm/morphological-contour-interpolation';
import { whenever } from '@vueuse/core';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';

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

type FillState = StartState | ComputingState | PreviewingState;

export const useFillBetweenStore = defineStore('fillBetween', () => {
  const fillState = ref<FillState>({ step: 'start' });

  const fillStep = computed(() => fillState.value.step);

  function resetState() {
    fillState.value = { step: 'start' };
  }

  const segmentGroupStore = useSegmentGroupStore();
  const paintStore = usePaintToolStore();
  const { activeSegmentGroupID, activeSegment } = storeToRefs(paintStore);
  const messageStore = useMessageStore();
  const { currentImageID } = useCurrentImage();

  function rollbackPreview(
    image: vtkLabelMap,
    originalScalars: TypedArray | number[]
  ): void {
    image.getPointData().getScalars().setData(originalScalars);
    image.modified();
  }

  async function computeFillBetween(groupId: string) {
    const segImage = segmentGroupStore.dataIndex[groupId];
    const originalScalars = segImage.getPointData().getScalars().getData();

    fillState.value = {
      step: 'computing',
      activeParentImageID: segmentGroupStore.metadataByID[groupId].parentImage,
    };

    if (!paintStore.activeSegment) {
      messageStore.addError('No active segment selected');
      resetState();
      return;
    }

    try {
      const vtkImage = vtkITKHelper.convertVtkToItkImage(segImage);
      const out = await morphologicalContourInterpolation(vtkImage, {
        label: paintStore.activeSegment,
      });

      // If the state changed during the async operation, stop processing.
      if (fillState.value.step !== 'computing') {
        return; // cancelFill handled the state change
      }

      const vtkOut = vtkITKHelper.convertItkToVtkImage(out.outputImage);
      const outputScalars = vtkOut.getPointData().getScalars();

      segImage.getPointData().getScalars().setData(outputScalars.getData());
      segImage.modified();

      fillState.value = {
        step: 'previewing',
        activeParentImageID:
          segmentGroupStore.metadataByID[groupId].parentImage,
        segImage,
        originalScalars,
      };
    } catch (error) {
      messageStore.addError('Fill Between Operation Failed', error as Error);
      if (fillState.value.step === 'computing') {
        rollbackPreview(segImage, originalScalars);
        resetState();
      }
    }
  }

  function confirmFill() {
    resetState();
  }

  function cancelFill() {
    const state = fillState.value;

    if (state.step === 'previewing') {
      rollbackPreview(state.segImage, state.originalScalars);
    }
    resetState();
  }

  whenever(
    () => paintStore.activeMode !== PaintMode.FillBetween,
    () => {
      cancelFill();
    }
  );

  watch(activeSegment, () => {
    cancelFill();
  });

  watch(activeSegmentGroupID, () => {
    cancelFill();
  });

  watch(currentImageID, (newVal) => {
    const state = fillState.value;
    if (
      (state.step === 'computing' || state.step === 'previewing') &&
      state.activeParentImageID !== newVal
    ) {
      cancelFill();
    }
  });

  return {
    fillState,
    fillStep,
    computeFillBetween,
    confirmFill,
    cancelFill,
  };
});
