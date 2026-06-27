import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentGroupStore } from '../segmentGroups';

export enum ProcessType {
  FillHoles = 'fillHoles',
  FillBetween = 'fillBetween',
  GaussianSmooth = 'gaussianSmooth',
}

type StartState = {
  step: 'start';
};

type ComputingState = {
  step: 'computing';
  activeParentImageID: string | null;
  activeSegmentGroupID: string;
  processType: ProcessType;
};

type PreviewingState = {
  step: 'previewing';
  activeParentImageID: string | null;
  activeSegmentGroupID: string;
  processType: ProcessType;
  segImage: vtkLabelMap;
  originalScalars: TypedArray | number[];
  processedScalars: TypedArray | number[];
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

export type ProcessAlgorithm = (
  segImage: vtkLabelMap,
  activeSegment: number
) => Promise<TypedArray | number[]>;

export const usePaintProcessStore = defineStore('paintProcess', () => {
  const processState = ref<ProcessState>({ step: 'start' });
  const activeProcessType = ref<ProcessType>(ProcessType.FillHoles);
  let activeProcessRunId = 0;

  const processStep = computed(() => processState.value.step);

  const showingOriginal = computed(() => {
    const state = processState.value;
    return state.step === 'previewing' ? state.showingOriginal : false;
  });

  function resetState() {
    processState.value = { step: 'start' };
  }

  function confirmProcess() {
    const state = processState.value;
    // Apply commits the processed result. When the user is viewing the
    // original, the image currently holds originalScalars, so restore the
    // processed scalars before finishing or the result is silently discarded.
    if (state.step === 'previewing' && state.showingOriginal) {
      state.segImage
        .getPointData()
        .getScalars()
        .setData(state.processedScalars);
      state.segImage.modified();
    }
    resetState();
    paintStore.restoreModeAfterProcess();
  }

  const segmentGroupStore = useSegmentGroupStore();
  const paintStore = usePaintToolStore();
  const { activeSegmentGroupID } = storeToRefs(paintStore);
  const messageStore = useMessageStore();
  const { currentImageID } = useCurrentImage('global');

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
    paintStore.restoreModeAfterProcess();
  }

  function setActiveProcessType(processType: ProcessType) {
    // Cancel any active process before switching
    cancelProcess();
    activeProcessType.value = processType;
  }

  async function startProcess(
    groupId: string,
    algorithm: ProcessAlgorithm,
    options?: { requiresActiveSegment?: boolean }
  ) {
    const activeSegment = paintStore.activeSegment;
    // Most processes operate on the active segment; all-segments processes opt
    // out so they are not blocked by (or limited to) a single active segment.
    const requiresActiveSegment = options?.requiresActiveSegment ?? true;

    if (requiresActiveSegment) {
      if (!activeSegment) {
        messageStore.addError('No active segment selected');
        return;
      }

      // Check if the active segment is locked
      const segment = segmentGroupStore.getSegment(groupId, activeSegment);
      if (segment?.locked) {
        messageStore.addError('Cannot process locked segment');
        return;
      }
    }

    const segImage = segmentGroupStore.dataIndex[groupId];
    const activeParentImageID =
      segmentGroupStore.metadataByID[groupId].parentImage;
    const processType = activeProcessType.value;
    const processRunId = ++activeProcessRunId;

    const originalScalars = segImage
      .getPointData()
      .getScalars()
      .getData()
      .slice();

    paintStore.enterProcessMode();
    processState.value = {
      step: 'computing',
      activeParentImageID,
      activeSegmentGroupID: groupId,
      processType,
    };

    try {
      const outputScalars = await algorithm(segImage, activeSegment ?? 0);

      // If the state changed during the async operation, stop processing.
      if (
        processRunId !== activeProcessRunId ||
        processState.value.step !== 'computing'
      ) {
        return;
      }

      const scalars = segImage.getPointData().getScalars();
      scalars.setData(outputScalars);
      segImage.modified();

      processState.value = {
        step: 'previewing',
        activeParentImageID,
        activeSegmentGroupID: groupId,
        processType,
        segImage,
        originalScalars,
        processedScalars: outputScalars,
        showingOriginal: false,
      };
    } catch (error) {
      if (
        processRunId !== activeProcessRunId ||
        processState.value.step !== 'computing'
      ) {
        return;
      }

      messageStore.addError(`${processType} Operation Failed`, {
        error: error as Error,
      });
      rollbackPreview(segImage, originalScalars);
      resetState();
      paintStore.restoreModeAfterProcess();
    }
  }

  function togglePreview() {
    const state = processState.value;

    if (state.step === 'previewing') {
      const newShowingOriginal = !state.showingOriginal;
      const scalarsToShow = newShowingOriginal
        ? state.originalScalars
        : state.processedScalars;

      state.segImage.getPointData().getScalars().setData(scalarsToShow);
      state.segImage.modified();

      processState.value = {
        ...state,
        showingOriginal: newShowingOriginal,
      };
    }
  }

  watch(
    () => paintStore.activeMode,
    (mode, previousMode) => {
      if (previousMode !== PaintMode.Process || mode === PaintMode.Process) {
        return;
      }
      const state = processState.value;
      if (state.step !== 'computing' && state.step !== 'previewing') {
        return;
      }
      cancelProcess();
    }
  );

  // Cancel process when active segment group changes
  watch(activeSegmentGroupID, (groupId) => {
    const state = processState.value;
    if (state.step !== 'computing' && state.step !== 'previewing') {
      return;
    }
    if (state.activeSegmentGroupID === groupId) {
      return;
    }
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
    startProcess,
    confirmProcess,
    cancelProcess,
    togglePreview,
    resetState,
  };
});
