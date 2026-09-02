import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import type { VoxelStorage } from '@/src/types/segmentation';
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
  activeParentImageID: string;
  segmentId: string;
};

type ComputingState = TargetedState & {
  step: 'computing';
};

type PreviewingState = TargetedState & {
  step: 'previewing';
  voxels: VoxelStorage;
  originalScalars: TypedArray;
  processedScalars: TypedArray | number[];
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

/**
 * The resolved storage a process writes into, passed instead of being
 * re-derived. An all-segments process gets the image's composite and no
 * segment, so it carries no label value rather than a dummy one.
 */
export type ProcessTarget =
  | {
      scope: 'segment';
      parentImageId: string;
      voxels: VoxelStorage;
      labelValue: number;
    }
  | { scope: 'image'; parentImageId: string; voxels: VoxelStorage };

export type ProcessAlgorithm = (
  target: ProcessTarget
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

  // Storage can be deleted while a preview is up, and the accessor re-resolves,
  // so every preview write is conditional on the storage still being there.
  // A mask another tool grew no longer has the shape the snapshot was taken
  // at, and a snapshot of the old shape cannot be written back at all.
  function writeIfPresent(
    voxels: VoxelStorage,
    scalars: TypedArray | number[]
  ) {
    if (!voxels.exists()) return;
    if (voxels.scalars().length !== scalars.length) return;
    voxels.apply(scalars);
  }

  function confirmProcess() {
    const state = processState.value;
    // Apply commits the processed result. When the user is viewing the
    // original, the image currently holds originalScalars, so restore the
    // processed scalars before finishing or the result is silently discarded.
    if (state.step === 'previewing' && state.showingOriginal) {
      writeIfPresent(state.voxels, state.processedScalars);
    }
    resetState();
    paintStore.restoreModeAfterProcess();
  }

  const segmentationStore = useSegmentationStore();
  const paintStore = usePaintToolStore();
  const messageStore = useMessageStore();
  const { currentImageID } = useCurrentImage('global');

  function cancelProcess() {
    const state = processState.value;

    if (state.step === 'previewing') {
      writeIfPresent(state.voxels, state.originalScalars);
    }
    resetState();
    paintStore.restoreModeAfterProcess();
  }

  function setActiveProcessType(processType: ProcessType) {
    // Cancel any active process before switching
    cancelProcess();
    activeProcessType.value = processType;
  }

  // Segment-scoped: resolveEditTarget creates the segment if needed, then
  // storage is allocated for it.
  function resolveSegmentScoped(imageId: string) {
    const segmentId = segmentationStore.resolveEditTarget(imageId);
    if (segmentationStore.getSegment(segmentId).locked) {
      messageStore.addError('Cannot process locked segment');
      return undefined;
    }
    const binding = segmentationStore.ensureLabelmapBinding(segmentId);
    return {
      target: {
        scope: 'segment' as const,
        parentImageId: imageId,
        voxels: segmentationStore.segmentVoxels(segmentId),
        labelValue: binding.labelValue,
      },
      segmentId,
    };
  }

  // Image-scoped: every segment of the image at once, through the composite.
  // Nothing is created, and an image with no mask has nothing to process.
  function resolveImageScoped(imageId: string) {
    const voxels = segmentationStore.imageVoxels(imageId);
    if (!voxels.exists()) {
      messageStore.addError('No segmentation to process');
      return undefined;
    }
    // The active segment is not part of the target; it is recorded only so the
    // watcher can cancel when the user moves to another segment.
    return {
      target: {
        scope: 'image' as const,
        parentImageId: imageId,
        voxels,
      },
      segmentId: segmentationStore.activeSegmentId ?? '',
    };
  }

  // A run the user has already moved past: another process started, or the
  // state machine left the step this one is finishing.
  const runIsStale = (processRunId: number) =>
    processRunId !== activeProcessRunId ||
    processState.value.step !== 'computing';

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

    // An all-segments process writes every mask of the image, so it resolves
    // the image rather than a segment. Only the segment-scoped path goes
    // through resolveEditTarget, which is the one call that creates segments.
    const resolved = requiresActiveSegment
      ? resolveSegmentScoped(imageId)
      : resolveImageScoped(imageId);
    if (!resolved) return;
    const { target, segmentId } = resolved;
    const { voxels, parentImageId: activeParentImageID } = target;

    const processType = activeProcessType.value;
    const processRunId = ++activeProcessRunId;

    const originalScalars = voxels.snapshot();

    paintStore.enterProcessMode();
    processState.value = {
      step: 'computing',
      activeParentImageID,
      segmentId,
    };

    try {
      const outputScalars = await algorithm(target);

      if (runIsStale(processRunId)) return;

      // The storage can be deleted while the algorithm runs; there is then
      // nothing to preview and nothing to roll back.
      if (!voxels.exists()) {
        resetState();
        paintStore.restoreModeAfterProcess();
        return;
      }

      // The preview keeps the returned array, so an algorithm handing back the
      // buffer it was given would leave the processed result aliasing storage
      // and the first toggle to the original would erase it.
      if (outputScalars === voxels.scalars()) {
        throw new Error('Process returned the storage buffer it was given');
      }
      voxels.apply(outputScalars);

      processState.value = {
        step: 'previewing',
        activeParentImageID,
        segmentId,
        voxels,
        originalScalars,
        // The algorithm's own array, not a copy of it: an algorithm must not
        // retain and mutate what it returns.
        processedScalars: outputScalars,
        showingOriginal: false,
      };
    } catch (error) {
      if (runIsStale(processRunId)) return;

      messageStore.addError(`${processType} Operation Failed`, {
        error: error as Error,
      });
      writeIfPresent(voxels, originalScalars);
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

      writeIfPresent(state.voxels, scalarsToShow);

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

  // A preview belongs to the paint tool: putting the brush down hands the
  // segment to another tool, which is free to grow the mask the preview holds
  // a snapshot of.
  watch(
    () => paintStore.isActive,
    (isActive) => {
      if (isActive) return;
      const state = processState.value;
      if (state.step !== 'computing' && state.step !== 'previewing') return;
      cancelProcess();
    }
  );

  // Cancel process when the active segment changes
  watch(
    () => segmentationStore.activeSegmentId,
    (segmentId) => {
      const state = processState.value;
      if (state.step !== 'computing' && state.step !== 'previewing') {
        return;
      }
      if (state.segmentId === segmentId) return;
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
  };
});
