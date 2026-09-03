import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import {
  extentSize,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  listSegments,
  type Extent3D,
  type VoxelStorage,
} from '@/src/types/segmentation';
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

/** One segment's slot in a run: what it held, and what the algorithm made. */
type PreviewRun = {
  target: ProcessTarget;
  originalScalars: TypedArray;
  processedScalars: TypedArray | number[];
};

type PreviewingState = TargetedState & {
  step: 'previewing';
  runs: PreviewRun[];
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

/**
 * The resolved storage a process writes into, passed instead of being
 * re-derived. Every process is scoped to one segment and writes one label into
 * that segment's own bounded mask; a run over every segment is a run per
 * segment, since one buffer cannot hold two labels in the same voxel.
 */
export type ProcessTarget = {
  parentImageId: string;
  segmentId: string;
  voxels: VoxelStorage;
  labelValue: number;
};

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

  /**
   * A process claims the voxels it turned on the way a brush stroke does: every
   * unlocked segment of the image releases them, a locked one keeps its own and
   * the two overlap. Mask offsets are relative to the segment's own extent,
   * read at commit time because growth moves it.
   */
  function claimTurnedOnVoxels(
    segmentId: string,
    before: TypedArray | number[],
    after: TypedArray | number[]
  ) {
    const binding = segmentationStore.findSegmentBinding(segmentId);
    if (!binding || isEmptyExtent(binding.extent)) return;
    const extent = [...binding.extent] as Extent3D;
    const [mi, mj, mk] = extentSize(extent);
    // A mask reshaped since the run cannot be addressed by these offsets.
    if (after.length !== mi * mj * mk || before.length !== after.length) return;

    const clearOtherSegments = segmentationStore.otherSegmentClearer(segmentId);
    for (let offset = 0; offset < after.length; offset += 1) {
      const turnedOn =
        after[offset] !== LABELMAP_BACKGROUND_VALUE &&
        before[offset] === LABELMAP_BACKGROUND_VALUE;
      if (turnedOn) {
        clearOtherSegments(
          (offset % mi) + extent[0],
          (Math.floor(offset / mi) % mj) + extent[2],
          Math.floor(offset / (mi * mj)) + extent[4]
        );
      }
    }
  }

  /**
   * One segment's preview slot, or nothing when its storage went away while the
   * algorithm ran. The result is kept as the algorithm's own array rather than
   * a copy: an algorithm handing back the buffer it was given would leave the
   * processed result aliasing storage, and the first toggle to the original
   * would erase it.
   */
  function buildRun(
    target: ProcessTarget,
    originalScalars: TypedArray,
    processedScalars: TypedArray | number[]
  ): PreviewRun[] {
    if (!target.voxels.exists()) return [];
    if (processedScalars === target.voxels.scalars()) {
      throw new Error('Process returned the storage buffer it was given');
    }
    return [{ target, originalScalars, processedScalars }];
  }

  function confirmProcess() {
    const state = processState.value;
    if (state.step === 'previewing') {
      // Apply commits the processed result. When the user is viewing the
      // original, the masks currently hold originalScalars, so restore the
      // processed scalars before finishing or the result is silently discarded.
      if (state.showingOriginal) {
        state.runs.forEach((run) =>
          writeIfPresent(run.target.voxels, run.processedScalars)
        );
      }
      // Only on confirm: a cancelled preview must leave the neighbours holding
      // everything they had. Where two segments of the same run turned the same
      // background voxel on, each takes it from the other and it stays
      // background, which is what it was before the run.
      state.runs.forEach((run) =>
        claimTurnedOnVoxels(
          run.target.segmentId,
          run.originalScalars,
          run.processedScalars
        )
      );
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
      state.runs.forEach((run) =>
        writeIfPresent(run.target.voxels, run.originalScalars)
      );
    }
    resetState();
    paintStore.restoreModeAfterProcess();
  }

  function setActiveProcessType(processType: ProcessType) {
    // Cancel any active process before switching
    cancelProcess();
    activeProcessType.value = processType;
  }

  const targetFor = (
    parentImageId: string,
    segment: { segmentId: string; labelValue: number }
  ): ProcessTarget => ({
    parentImageId,
    segmentId: segment.segmentId,
    voxels: segmentationStore.segmentVoxels(segment.segmentId),
    labelValue: segment.labelValue,
  });

  // Segment-scoped: resolveEditTarget creates the segment if needed, then
  // storage is allocated for it.
  function resolveSegmentScoped(imageId: string) {
    const segmentId = segmentationStore.resolveEditTarget(imageId);
    if (segmentationStore.getSegment(segmentId).locked) {
      messageStore.addError('Cannot process locked segment');
      return undefined;
    }
    const { labelValue } = segmentationStore.ensureLabelmapBinding(segmentId);
    return {
      targets: [targetFor(imageId, { segmentId, labelValue })],
      segmentId,
    };
  }

  // An image with segments on it and nothing editable is refusing for a reason
  // the user can act on, so it does not get the empty image's message.
  function nothingEditable(imageId: string) {
    const segmentation = segmentationStore.getSegmentationForImage(imageId);
    const segments = segmentation ? listSegments(segmentation) : [];
    if (segments.length === 0) return 'No segmentation to process';
    return segments.every((segment) => segment.locked)
      ? 'Every segment is locked'
      : 'No unlocked segment has anything to process';
  }

  // All-segments: one run per editable segment, each on its own bounded mask.
  // Nothing is created, and an image with no editable segment has nothing to
  // process.
  function resolveEverySegment(imageId: string) {
    const targets = segmentationStore
      .editableSegments(imageId)
      .map((segment) => targetFor(imageId, segment));
    if (targets.length === 0) {
      messageStore.addError(nothingEditable(imageId));
      return undefined;
    }
    // The active segment is not part of the target; it is recorded only so the
    // watcher can cancel when the user moves to another segment.
    return { targets, segmentId: segmentationStore.activeSegmentId ?? '' };
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

    // An all-segments process runs once per editable segment. Only the
    // segment-scoped path goes through resolveEditTarget, which is the one call
    // that creates segments.
    const resolved = requiresActiveSegment
      ? resolveSegmentScoped(imageId)
      : resolveEverySegment(imageId);
    if (!resolved) return;
    const { targets, segmentId } = resolved;

    const processType = activeProcessType.value;
    const processRunId = ++activeProcessRunId;

    const snapshots = targets.map((target) => target.voxels.snapshot());

    paintStore.enterProcessMode();
    processState.value = {
      step: 'computing',
      activeParentImageID: imageId,
      segmentId,
    };

    try {
      // Started together, so every algorithm reads its own mask before any
      // result is written back: each run sees the state the user acted on.
      const outputs = await Promise.all(
        targets.map((target) => algorithm(target))
      );

      if (runIsStale(processRunId)) return;

      const runs = targets.flatMap((target, index) =>
        buildRun(target, snapshots[index], outputs[index])
      );

      // Every mask the run held was deleted while the algorithm ran; there is
      // then nothing to preview and nothing to roll back.
      if (runs.length === 0) {
        resetState();
        paintStore.restoreModeAfterProcess();
        return;
      }

      runs.forEach((run) => run.target.voxels.apply(run.processedScalars));

      processState.value = {
        step: 'previewing',
        activeParentImageID: imageId,
        segmentId,
        runs,
        showingOriginal: false,
      };
    } catch (error) {
      if (runIsStale(processRunId)) return;

      messageStore.addError(`${processType} Operation Failed`, {
        error: error as Error,
      });
      targets.forEach((target, index) =>
        writeIfPresent(target.voxels, snapshots[index])
      );
      resetState();
      paintStore.restoreModeAfterProcess();
    }
  }

  function togglePreview() {
    const state = processState.value;

    if (state.step === 'previewing') {
      const newShowingOriginal = !state.showingOriginal;
      state.runs.forEach((run) =>
        writeIfPresent(
          run.target.voxels,
          newShowingOriginal ? run.originalScalars : run.processedScalars
        )
      );

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
