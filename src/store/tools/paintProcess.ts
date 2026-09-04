import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import {
  extentSize,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  type Extent3D,
  type VoxelStorage,
} from '@/src/types/segmentation';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
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
  // The segment whose selection owns the run, absent for an all-segments run:
  // that run belongs to no one segment, so no selection change is about it.
  watchedSegmentId?: string;
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
  parentDimensions: [number, number, number];
  segmentId: string;
  voxels: VoxelStorage;
  maskExtent: Extent3D;
  labelValue: number;
};

/** What a resolved start has to run, and whose selection owns it. */
type ResolvedRun = {
  targets: ProcessTarget[];
  watchedSegmentId?: string;
};

/**
 * One segment's new mask contents, or `undefined` where the algorithm has
 * nothing to do to that segment: a run with no result is dropped rather than
 * written back, so an untouched mask keeps its buffer and the renderer is not
 * invalidated for it.
 */
export type ProcessAlgorithm = (
  target: ProcessTarget
) => Promise<TypedArray | number[] | undefined>;

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
   * The extent and strides a run's mask offsets are taken against, absent when
   * the mask has been reshaped since and they no longer address it. The binding
   * is read here because `target.voxels` carries none and growth moves it.
   */
  function runMaskBounds(run: PreviewRun) {
    const binding = segmentationStore.findSegmentBinding(run.target.segmentId);
    if (!binding || isEmptyExtent(binding.extent)) return undefined;
    const extent = [...binding.extent] as Extent3D;
    const [mi, mj, mk] = extentSize(extent);
    const addressable =
      run.processedScalars.length === mi * mj * mk &&
      run.originalScalars.length === run.processedScalars.length;
    return addressable ? { extent, mi, mj } : undefined;
  }

  /**
   * Drops from the result every voxel the algorithm turned on that another
   * segment already holds: a process is a `sweep`, so it takes nothing from a
   * neighbour. Masking the result rather than the storage keeps the preview
   * honest: what it shows is what confirm leaves behind.
   */
  function maskVoxelsOtherSegmentsHold(run: PreviewRun) {
    const bounds = runMaskBounds(run);
    if (!bounds) return;

    // Absent when no other segment's box reaches this one, which is the common
    // case: nothing can then be dropped, so the result is not walked at all.
    const claimVoxel = segmentationStore.voxelClaim(
      run.target.segmentId,
      'sweep',
      bounds.extent
    );
    if (!claimVoxel) return;

    const { extent } = bounds;
    const before = run.originalScalars;
    const after = run.processedScalars;
    const [ni, nj, nk] = extentSize(extent);
    // Rows flat in one loop, as the mask sweeps are: a voxel's parent index is
    // then a step along i from the row's own start, not a divide per voxel.
    for (let row = 0; row < nj * nk; row += 1) {
      const j = extent[2] + (row % nj);
      const k = extent[4] + Math.floor(row / nj);
      const from = row * ni;
      for (let n = 0; n < ni; n += 1) {
        const turnedOn =
          after[from + n] !== LABELMAP_BACKGROUND_VALUE &&
          before[from + n] === LABELMAP_BACKGROUND_VALUE;
        if (turnedOn && !claimVoxel(extent[0] + n, j, k)) {
          after[from + n] = LABELMAP_BACKGROUND_VALUE;
        }
      }
    }
  }

  /**
   * One segment's preview slot, or nothing when the algorithm changed nothing
   * or its storage went away while the algorithm ran. The result is kept as the
   * algorithm's own array rather than a copy: an algorithm handing back the buffer it was given would leave the
   * processed result aliasing storage, and the first toggle to the original
   * would erase it.
   */
  function buildRun(
    target: ProcessTarget,
    originalScalars: TypedArray,
    processedScalars: TypedArray | number[] | undefined
  ): PreviewRun[] {
    if (processedScalars === undefined) return [];
    if (!target.voxels.exists()) return [];
    if (processedScalars === target.voxels.scalars()) {
      throw new Error('Process returned the storage buffer it was given');
    }
    return [{ target, originalScalars, processedScalars }];
  }

  function confirmProcess() {
    const state = processState.value;
    // Apply commits the processed result. When the user is viewing the
    // original, the masks currently hold originalScalars, so restore the
    // processed scalars before finishing or the result is silently discarded.
    if (state.step === 'previewing' && state.showingOriginal) {
      state.runs.forEach((run) =>
        writeIfPresent(run.target.voxels, run.processedScalars)
      );
    }
    resetState();
    paintStore.restoreModeAfterProcess();
  }

  const segmentationStore = useSegmentationStore();
  const imageCacheStore = useImageCacheStore();
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

  function targetFor(parentImageId: string, segmentId: string) {
    const parent = segmentationStore.getSegmentationForImage(parentImageId);
    const voxels = segmentationStore.segmentVoxels(segmentId);
    const binding = voxels.binding();
    const image = parent && imageCacheStore.getVtkImageData(parentImageId);
    if (
      !binding ||
      isEmptyExtent(binding.extent) ||
      !voxels.exists() ||
      !image
    ) {
      return undefined;
    }
    return {
      parentImageId,
      parentDimensions: [...image.getDimensions()] as [number, number, number],
      segmentId,
      voxels,
      maskExtent: [...binding.extent] as Extent3D,
      labelValue: binding.labelValue,
    } satisfies ProcessTarget;
  }

  function resolveSegmentScoped(imageId: string): ResolvedRun | undefined {
    const segmentId = segmentationStore.findEditTarget(imageId);
    if (!segmentId) {
      messageStore.addError('No active segment selected');
      return undefined;
    }
    if (segmentationStore.getSegment(segmentId).locked) {
      messageStore.addError('Cannot process locked segment');
      return undefined;
    }
    const target = targetFor(imageId, segmentId);
    if (!target) {
      messageStore.addError('No segment content to process');
      return undefined;
    }
    return {
      targets: [target],
      watchedSegmentId: segmentId,
    };
  }

  // An image with segments on it and nothing editable is refusing for a reason
  // the user can act on, so it does not get the empty image's message.
  function nothingEditable(imageId: string) {
    const segments = segmentationStore.imageSegments(imageId);
    if (segments.length === 0) return 'No segmentation to process';
    return segments.every((segment) => segment.locked)
      ? 'Every segment is locked'
      : 'No unlocked segment has anything to process';
  }

  // All-segments: one run per editable segment, each on its own bounded mask.
  // Nothing is created, and an image with no editable segment has nothing to
  // process.
  function resolveEverySegment(imageId: string): ResolvedRun | undefined {
    const targets = segmentationStore
      .editableSegments(imageId)
      .flatMap(({ segmentId }) => {
        const target = targetFor(imageId, segmentId);
        return target ? [target] : [];
      });
    if (targets.length === 0) {
      messageStore.addError(nothingEditable(imageId));
      return undefined;
    }
    // No watched segment: the selection is not part of the target, so moving
    // off it is not a reason to throw the run away.
    return { targets };
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

    const resolved = requiresActiveSegment
      ? resolveSegmentScoped(imageId)
      : resolveEverySegment(imageId);
    if (!resolved) return;
    const { targets, watchedSegmentId } = resolved;

    const processType = activeProcessType.value;
    const processRunId = ++activeProcessRunId;

    const snapshots = targets.map((target) => target.voxels.snapshot());

    paintStore.enterProcessMode();
    processState.value = {
      step: 'computing',
      activeParentImageID: imageId,
      watchedSegmentId,
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

      // No segment came back with anything to write: every mask was deleted
      // while the algorithm ran, or the algorithm had nothing to do to any of
      // them. There is then nothing to preview and nothing to roll back.
      if (runs.length === 0) {
        resetState();
        paintStore.restoreModeAfterProcess();
        return;
      }

      // Masked against what the segments hold now, so a run that reaches a
      // voxel an earlier run of the same pass just filled leaves it there.
      runs.forEach((run) => {
        maskVoxelsOtherSegmentsHold(run);
        run.target.voxels.apply(run.processedScalars);
      });

      processState.value = {
        step: 'previewing',
        activeParentImageID: imageId,
        watchedSegmentId,
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

  // A preview holds a snapshot of storage another action can delete under it,
  // so it does not outlive what it would write back into. Storage is its own
  // matter: an all-segments run watches no segment, and a segment-scoped one is
  // not the only way to lose a mask.
  const previewStorageGone = computed(() => {
    const state = processState.value;
    if (state.step !== 'previewing') return false;
    return state.runs.some((run) => !run.target.voxels.exists());
  });

  watch(previewStorageGone, (gone) => {
    if (gone) cancelProcess();
  });

  // A segment-scoped run belongs to the segment it was started on, so moving
  // off that segment throws it away. An all-segments run watches no segment and
  // outlives the selection changing under it.
  watch(
    () => segmentationStore.activeSegmentId,
    (segmentId) => {
      const state = processState.value;
      if (state.step !== 'computing' && state.step !== 'previewing') {
        return;
      }
      if (state.watchedSegmentId === undefined) return;
      if (state.watchedSegmentId === segmentId) return;
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
