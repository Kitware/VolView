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
  activeParentImageID: string | null;
  segmentId: string;
  processType: ProcessType;
};

type ComputingState = TargetedState & {
  step: 'computing';
};

type PreviewingState = TargetedState & {
  step: 'previewing';
  voxels: VoxelStorage;
  originalScalars: TypedArray;
  processedScalars: TypedArray;
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

/**
 * The resolved storage a process writes into, passed instead of being
 * re-derived. An all-segments process has an artifact and no segment, so it
 * carries no label value at all rather than a dummy one.
 */
export type ProcessTarget =
  | {
      scope: 'segment';
      voxels: VoxelStorage;
      artifactId: string;
      labelValue: number;
    }
  | { scope: 'artifact'; voxels: VoxelStorage; artifactId: string };

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
  function writeIfPresent(
    voxels: VoxelStorage,
    scalars: TypedArray | number[]
  ) {
    if (!voxels.exists()) return;
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

  function rollbackPreview(
    voxels: VoxelStorage,
    originalScalars: TypedArray
  ): void {
    writeIfPresent(voxels, originalScalars);
  }

  function cancelProcess() {
    const state = processState.value;

    if (state.step === 'previewing') {
      rollbackPreview(state.voxels, state.originalScalars);
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
        voxels: segmentationStore.segmentVoxels(segmentId),
        artifactId: binding.artifactId,
        labelValue: binding.labelValue,
      },
      segmentId,
    };
  }

  // Artifact-scoped: nothing is created, and an image with no artifact has
  // nothing to process.
  function resolveArtifactScoped(imageId: string) {
    const active = segmentationStore.activeArtifactId;
    const forImage = segmentationStore.artifactsForImage(imageId);
    const artifactId =
      active && forImage.includes(active) ? active : forImage[0];
    if (!artifactId) {
      messageStore.addError('No segmentation to process');
      return undefined;
    }
    // The active segment is not part of the target; it is recorded only so the
    // watcher can cancel when the user moves to another segment.
    return {
      target: {
        scope: 'artifact' as const,
        voxels: segmentationStore.artifactVoxels(artifactId),
        artifactId,
      },
      segmentId: segmentationStore.activeSegmentId ?? '',
    };
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

    // An all-segments process writes the whole artifact, so it resolves an
    // existing artifact rather than a segment. Only the segment-scoped path
    // goes through resolveEditTarget, which is the one call that creates
    // segments.
    const resolved = requiresActiveSegment
      ? resolveSegmentScoped(imageId)
      : resolveArtifactScoped(imageId);
    if (!resolved) return;
    const { target, segmentId } = resolved;
    const { voxels, artifactId } = target;

    const activeParentImageID =
      segmentationStore.artifactMeta[artifactId].parentImage;
    const processType = activeProcessType.value;
    const processRunId = ++activeProcessRunId;

    const originalScalars = voxels.snapshot();

    paintStore.enterProcessMode();
    processState.value = {
      step: 'computing',
      activeParentImageID,
      segmentId,
      processType,
    };

    try {
      const outputScalars = await algorithm(target);

      // If the state changed during the async operation, stop processing.
      if (
        processRunId !== activeProcessRunId ||
        processState.value.step !== 'computing'
      ) {
        return;
      }

      // The storage can be deleted while the algorithm runs; there is then
      // nothing to preview and nothing to roll back.
      if (!voxels.exists()) {
        resetState();
        paintStore.restoreModeAfterProcess();
        return;
      }

      voxels.apply(outputScalars);

      processState.value = {
        step: 'previewing',
        activeParentImageID,
        segmentId,
        processType,
        voxels,
        originalScalars,
        processedScalars: voxels.snapshot(),
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
      rollbackPreview(voxels, originalScalars);
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
    resetState,
  };
});
