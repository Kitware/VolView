import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import { whenever } from '@vueuse/core';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentGroupStore } from '../segmentGroups';

export enum ProcessType {
  FillBetween = 'fillBetween',
  GaussianSmooth = 'gaussianSmooth',
}

type StartState = {
  step: 'start';
};

type ComputingState = {
  step: 'computing';
  activeParentImageID: string | null;
  processType: ProcessType;
};

type PreviewingState = {
  step: 'previewing';
  activeParentImageID: string | null;
  processType: ProcessType;
  segImage: vtkLabelMap;
  originalScalars: TypedArray | number[];
  processedScalars: TypedArray | number[];
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

export interface ProcessAlgorithm {
  compute: (
    segImage: vtkLabelMap,
    activeSegment: number
  ) => Promise<TypedArray>;
}

export const useProcessStore = defineStore('process', () => {
  const processState = ref<ProcessState>({ step: 'start' });
  const activeProcessType = ref<ProcessType>(ProcessType.FillBetween);

  const processStep = computed(() => processState.value.step);

  const showingOriginal = computed(() => {
    const state = processState.value;
    return state.step === 'previewing' ? state.showingOriginal : false;
  });

  function resetState() {
    processState.value = { step: 'start' };
  }

  function confirmProcess() {
    resetState();
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

  function cancelProcess() {
    const state = processState.value;

    if (state.step === 'previewing') {
      rollbackPreview(state.segImage, state.originalScalars);
    }
    resetState();
  }

  function setActiveProcessType(processType: ProcessType) {
    // Cancel any active process before switching
    cancelProcess();
    activeProcessType.value = processType;
  }

  async function computeProcess(groupId: string, algorithm: ProcessAlgorithm) {
    const segImage = segmentGroupStore.dataIndex[groupId];
    const state = processState.value;

    const originalScalars =
      state.step === 'previewing'
        ? state.originalScalars
        : segImage.getPointData().getScalars().getData().slice();

    if (state.step === 'previewing') {
      rollbackPreview(segImage, state.originalScalars);
    }

    processState.value = {
      step: 'computing',
      activeParentImageID: segmentGroupStore.metadataByID[groupId].parentImage,
      processType: activeProcessType.value,
    };

    if (!paintStore.activeSegment) {
      messageStore.addError('No active segment selected');
      resetState();
      return;
    }

    try {
      const outputScalars = await algorithm.compute(
        segImage,
        paintStore.activeSegment
      );

      // If the state changed during the async operation, stop processing
      if (processState.value.step !== 'computing') {
        return; // cancelProcess handled the state change
      }

      const scalars = segImage.getPointData().getScalars();
      scalars.setData(outputScalars);
      segImage.modified();

      processState.value = {
        step: 'previewing',
        activeParentImageID:
          segmentGroupStore.metadataByID[groupId].parentImage,
        processType: activeProcessType.value,
        segImage,
        originalScalars,
        processedScalars: outputScalars,
        showingOriginal: false,
      };
    } catch (error) {
      messageStore.addError(
        `${activeProcessType.value} Operation Failed`,
        error as Error
      );
      if (processState.value.step === 'computing') {
        rollbackPreview(segImage, originalScalars);
        resetState();
      }
    }
  }

  function togglePreview() {
    const state = processState.value;

    if (state.step === 'previewing') {
      const newShowingOriginal = !state.showingOriginal;
      const scalarsToShow = newShowingOriginal
        ? state.originalScalars
        : state.processedScalars;

      // Update the image display
      state.segImage.getPointData().getScalars().setData(scalarsToShow);
      state.segImage.modified();

      // Update the state
      processState.value = {
        ...state,
        showingOriginal: newShowingOriginal,
      };
    }
  }

  // Cancel process when switching away from Process mode
  whenever(
    () => paintStore.activeMode !== PaintMode.Process,
    () => {
      cancelProcess();
    }
  );

  // Cancel process when active segment group changes
  watch(activeSegmentGroupID, () => {
    cancelProcess();
  });

  // Cancel process when current image changes
  watch(currentImageID, (newVal) => {
    const state = processState.value;
    if (
      (state.step === 'computing' || state.step === 'previewing') &&
      state.activeParentImageID !== newVal
    ) {
      cancelProcess();
    }
  });

  return {
    processState,
    processStep,
    activeProcessType,
    showingOriginal,
    setActiveProcessType,
    computeProcess,
    confirmProcess,
    cancelProcess,
    togglePreview,
    resetState,
  };
});
