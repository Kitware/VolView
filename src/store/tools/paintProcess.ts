import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentationStore } from '../segmentations';

export enum ProcessType {
  FillHoles = 'fillHoles',
  FillBetween = 'fillBetween',
  GaussianSmooth = 'gaussianSmooth',
}

type StartState = {
  step: 'start';
};

type TargetedState = {
  activeParentImageID: string | null;
  segmentationId: string;
  segmentId: string;
  processType: ProcessType;
};

type ComputingState = TargetedState & {
  step: 'computing';
};

type PreviewingState = TargetedState & {
  step: 'previewing';
  segImage: vtkLabelMap;
  originalScalars: TypedArray | number[];
  processedScalars: TypedArray | number[];
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

export type ProcessAlgorithm = (
  segImage: vtkLabelMap,
  labelValue: number
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

  const segmentationStore = useSegmentationStore();
  const paintStore = usePaintToolStore();
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

  function existingTargetForImage(imageId: string) {
    const segmentation = segmentationStore.getSegmentationForImage(imageId);
    if (!segmentation) return undefined;
    const active = segmentationStore.activeTarget;
    if (active?.segmentationId === segmentation.id) return active;
    const segmentId = segmentation.order[0];
    return segmentId
      ? { segmentationId: segmentation.id, segmentId }
      : undefined;
  }

  async function startProcess(
    algorithm: ProcessAlgorithm,
    options?: { requiresActiveSegment?: boolean }
  ) {
    // Most processes operate on the active segment; all-segments processes opt
    // out so they are not blocked by a locked active segment.
    const requiresActiveSegment = options?.requiresActiveSegment ?? true;

    const imageId = currentImageID.value;
    if (!imageId) {
      messageStore.addError('No image to process');
      return;
    }

    // resolveEditTarget is the one call that creates segments, so an
    // all-segments process reads an existing target instead of minting a
    // default segment or cloning the active one onto a merely viewed image.
    const target = requiresActiveSegment
      ? segmentationStore.resolveEditTarget(imageId)
      : existingTargetForImage(imageId);
    if (!target) {
      messageStore.addError('No segment to process');
      return;
    }
    const { segmentationId, segmentId } = target;

    if (
      requiresActiveSegment &&
      segmentationStore.getSegment(segmentationId, segmentId).locked
    ) {
      messageStore.addError('Cannot process locked segment');
      return;
    }

    const binding = segmentationStore.ensureLabelmapBinding(
      segmentationId,
      segmentId
    );
    const segImage = segmentationStore.artifactIndex[binding.artifactId];
    const activeParentImageID =
      segmentationStore.artifactMeta[binding.artifactId].parentImage;
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
      segmentationId,
      segmentId,
      processType,
    };

    try {
      const outputScalars = await algorithm(segImage, binding.labelValue);

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
        segmentationId,
        segmentId,
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

  // Cancel process when the active segment changes
  watch(
    () => segmentationStore.activeTarget,
    (target) => {
      const state = processState.value;
      if (state.step !== 'computing' && state.step !== 'previewing') {
        return;
      }
      if (
        state.segmentationId === target?.segmentationId &&
        state.segmentId === target?.segmentId
      ) {
        return;
      }
      cancelProcess();
    }
  );

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
