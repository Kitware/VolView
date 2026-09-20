import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { TypedArray } from '@kitware/vtk.js/types';
import type { Maybe } from '@/src/types';
import { arrayEquals, omit } from '@/src/utils';
import {
  LABELMAP_BACKGROUND_VALUE,
  maskHasContent,
  type VoxelStorage,
} from '@/src/segmentation/model';
import {
  extentContains,
  extentSize,
  extentUnion,
  fullExtent,
  isEmptyExtent,
  markedExtent,
  reframeMaskScalars,
  walkExtentRows,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { terminateProcessWorkers } from '@/src/segmentation/editing/processWorker';

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
  targetMaskIds: string[];
  // The mask whose segment's selection owns the run, absent for an
  // all-segments run: that run belongs to no one segment, so no selection
  // change is about it.
  watchedMaskId?: string;
};

type ComputingState = TargetedState & {
  step: 'computing';
};

type PreviewRun = {
  target: ResolvedTarget;
  extent: Extent3D;
  originalScalars: TypedArray;
  processedScalars: TypedArray | number[];
};

/** Algorithm output positioned in parent index space, including any growth. */
export type ProcessResult = {
  scalars: TypedArray | number[];
  extent: Extent3D;
};

type PreviewingState = TargetedState & {
  step: 'previewing';
  runs: PreviewRun[];
  showingOriginal: boolean;
};

type ProcessState = StartState | ComputingState | PreviewingState;

/** Detached algorithm input. Mutating it cannot change a stored mask. */
export type ProcessTarget = {
  parentImageId: string;
  parentDimensions: [number, number, number];
  parentOrigin: number[];
  maskId: string;
  scalars: TypedArray;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  direction: number[];
  maskExtent: Extent3D;
};

type ResolvedTarget = ProcessTarget & { voxels: VoxelStorage };

type ResolvedRun = {
  targets: ResolvedTarget[];
  watchedMaskId?: string;
};

/**
 * One segment's new mask contents, or `undefined` where the algorithm has
 * nothing to do to that segment: a run with no result is dropped rather than
 * written back, so an untouched mask keeps its buffer and the renderer is not
 * invalidated for it.
 */
export type ProcessAlgorithm = (
  target: ProcessTarget
) => Promise<ProcessResult | undefined>;

/** Validate placement and keep only the space the preview or original needs. */
function previewExtent(target: ProcessTarget, result: ProcessResult) {
  if (
    !result.extent.every(Number.isInteger) ||
    isEmptyExtent(result.extent) ||
    !extentContains(fullExtent(target.parentDimensions), result.extent) ||
    extentSize(result.extent).reduce((a, b) => a * b, 1) !==
      result.scalars.length
  ) {
    throw new Error('Process result does not fit its parent-grid extent');
  }
  if (extentContains(target.maskExtent, result.extent))
    return target.maskExtent;
  const occupied = markedExtent(result.scalars, result.extent);
  return isEmptyExtent(occupied)
    ? target.maskExtent
    : extentUnion(target.maskExtent, occupied);
}

export const usePaintProcessStore = defineStore('paintProcess', () => {
  const processState = ref<ProcessState>({ step: 'start' });
  const activeProcessType = ref<ProcessType>(ProcessType.FillHoles);
  let activeProcessRunId = 0;

  const processStep = computed(() => processState.value.step);

  const showingOriginal = computed(() => {
    const state = processState.value;
    return state.step === 'previewing' ? state.showingOriginal : false;
  });

  const edits = useSegmentationEditsStore();

  function endRun() {
    edits.release(cancelProcess);
    processState.value = { step: 'start' };
    paintStore.restoreModeAfterProcess();
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
   * Drops from the result every voxel the algorithm turned on that another
   * segment already holds: a process is a `sweep`, so it takes nothing from a
   * neighbor. Masking the result rather than the storage keeps the preview
   * honest: what it shows is what confirm leaves behind. Runs once the mask
   * has grown to the run's extent, so the run's offsets address it.
   */
  function maskVoxelsOtherSegmentsHold(run: PreviewRun) {
    const { extent } = run;
    // Absent when no other segment's box reaches this one, which is the common
    // case: nothing can then be dropped, so the result is not walked at all.
    const claimVoxel = segmentationStore.voxelClaim(
      run.target.maskId,
      'sweep',
      extent
    );
    if (!claimVoxel) return;

    const before = run.originalScalars;
    const after = run.processedScalars;
    const [ni] = extentSize(extent);
    // By rows, as the mask sweeps go: a voxel's parent index is then a step
    // along i from the row's own start, not a divide per voxel.
    walkExtentRows(extent, (j, k, row) => {
      const from = row * ni;
      for (let n = 0; n < ni; n += 1) {
        const turnedOn =
          after[from + n] !== LABELMAP_BACKGROUND_VALUE &&
          before[from + n] === LABELMAP_BACKGROUND_VALUE;
        if (turnedOn && !claimVoxel.claim(extent[0] + n, j, k)) {
          after[from + n] = LABELMAP_BACKGROUND_VALUE;
        }
      }
    });
  }

  /**
   * One segment's preview slot, or nothing when the algorithm changed nothing
   * or its storage went away while the algorithm ran. Both arrays are placed
   * on the same extent before storage grows, so toggling or cancelling also
   * restores voxels outside the input allocation. An algorithm must return a
   * separate buffer: aliasing storage would erase its result on the first toggle.
   */
  function buildRun(
    target: ResolvedTarget,
    result: ProcessResult | undefined
  ): PreviewRun[] {
    if (result === undefined) return [];
    const binding = segmentationStore.findMaskBinding(target.maskId);
    if (!binding || !arrayEquals(binding.extent, target.maskExtent)) return [];
    if (result.scalars === target.voxels.scalars()) {
      throw new Error('Process returned the storage buffer it was given');
    }
    const extent = previewExtent(target, result);
    return [
      {
        target,
        extent,
        originalScalars: arrayEquals(extent, target.maskExtent)
          ? target.scalars
          : reframeMaskScalars(target.scalars, target.maskExtent, extent),
        processedScalars: arrayEquals(extent, result.extent)
          ? result.scalars
          : reframeMaskScalars(result.scalars, result.extent, extent),
      },
    ];
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
    endRun();
    // After the run ends, since deleting a mask cancels a preview still held.
    if (state.step === 'previewing')
      segmentationStore.deleteEmptyMasks(
        state.runs.map((run) => run.target.maskId)
      );
  }

  const segmentationStore = useSegmentationStore();
  const segmentRegistry = useSegmentStore().segments;
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
    // A run still computing has jobs sitting in the workers, one of which is
    // running now and cannot be called back. Their results are already
    // discarded, so the worker goes with them: the run that replaces this one
    // starts on a fresh worker instead of waiting behind abandoned work.
    if (state.step === 'computing') terminateProcessWorkers();
    endRun();
  }

  // Locking any target cancels the whole uncommitted transaction. Rollback
  // restores the original contents even though further edits are now locked.
  const targetLocked = computed(() => {
    const state = processState.value;
    return (
      state.step !== 'start' &&
      state.targetMaskIds.some((maskId) => segmentationStore.isLocked(maskId))
    );
  });

  // Synchronous invalidation also honors a lock/unlock before Vue's next flush.
  watch(
    targetLocked,
    (locked) => {
      if (locked) cancelProcess();
    },
    { flush: 'sync' }
  );

  function setActiveProcessType(processType: ProcessType) {
    // Cancel any active process before switching
    cancelProcess();
    activeProcessType.value = processType;
  }

  // Distinguishes "every target's mask vanished mid-run" from "the algorithm
  // looked and found nothing", which alone is worth telling the user about.
  function warnIfNothingProcessed(
    outputs: (ProcessResult | undefined)[],
    label: string
  ) {
    if (!outputs.every((output) => output === undefined)) return;
    messageStore.addWarning(
      `${label} had nothing to do`,
      'None of the segments it ran on had anything for it to change.'
    );
  }

  function targetFor(parentImageId: string, maskId: string) {
    const voxels = segmentationStore.maskVoxels(maskId);
    const binding = voxels.binding();
    const image = imageCacheStore.getVtkImageData(parentImageId);
    if (!binding || isEmptyExtent(binding.extent) || !image) return undefined;
    return {
      parentImageId,
      parentDimensions: [...image.getDimensions()] as [number, number, number],
      parentOrigin: Array.from(image.getOrigin()),
      maskId,
      voxels,
      scalars: voxels.snapshot(),
      dimensions: extentSize(binding.extent),
      spacing: [...binding.image.getSpacing()] as [number, number, number],
      direction: Array.from(binding.image.getDirection()),
      maskExtent: [...binding.extent] as Extent3D,
    } satisfies ResolvedTarget;
  }

  // A selected segment with no mask on this image is selected all the same:
  // it just holds nothing here yet.
  function segmentScopedRefusal(imageId: string) {
    if (!segmentRegistry.selectedSegmentId.value)
      return 'No segments to process';
    const maskId = segmentationStore.findEditTarget(imageId);
    if (maskId && segmentationStore.isLocked(maskId))
      return 'Cannot process locked segment';
    return maskId && maskHasContent(segmentationStore.getMask(maskId))
      ? ''
      : 'No segment content to process';
  }

  // An image with segments on it and nothing editable is refusing for a reason
  // the user can act on, so it does not get the empty image's message.
  function nothingEditable(imageId: string) {
    const masks = segmentationStore.imageMasks(imageId);
    if (masks.length === 0) return 'No segmentation to process';
    return masks.every((mask) => segmentationStore.isLocked(mask.id))
      ? 'Every segment is locked'
      : 'No unlocked segment has anything to process';
  }

  /**
   * Why a run cannot start on this image now, or '' when it can. It copies
   * nothing, so a control can ask it on every change.
   */
  function startRefusal(imageId: Maybe<string>, requiresActiveSegment = true) {
    if (!imageId) return 'No image to process';
    if (requiresActiveSegment) return segmentScopedRefusal(imageId);
    return segmentationStore.editableMasks(imageId).length > 0
      ? ''
      : nothingEditable(imageId);
  }

  function resolveSegmentScoped(imageId: string): ResolvedRun | undefined {
    const maskId = segmentationStore.findEditTarget(imageId);
    const target = maskId && targetFor(imageId, maskId);
    if (!target) {
      messageStore.addError('No segment content to process');
      return undefined;
    }
    return {
      targets: [target],
      watchedMaskId: target.maskId,
    };
  }

  // All-segments: one run per editable segment, each on its own bounded mask.
  // Nothing is created, and an image with no editable segment has nothing to
  // process.
  function resolveEverySegment(imageId: string): ResolvedRun | undefined {
    const targets = segmentationStore
      .editableMasks(imageId)
      .flatMap((maskId) => targetFor(imageId, maskId) ?? []);
    if (targets.length === 0) {
      messageStore.addError(nothingEditable(imageId));
      return undefined;
    }
    // No watched segment: the selection is not part of the target, so moving
    // off it is not a reason to throw the run away.
    return { targets };
  }

  function resolveRun(imageId: string, requiresActiveSegment: boolean) {
    const refusal = startRefusal(imageId, requiresActiveSegment);
    if (refusal) {
      messageStore.addError(refusal);
      return undefined;
    }
    return requiresActiveSegment
      ? resolveSegmentScoped(imageId)
      : resolveEverySegment(imageId);
  }

  // A process holding storage the user can still cancel out of.
  const runInFlight = () => {
    const state = processState.value;
    return state.step === 'computing' || state.step === 'previewing'
      ? state
      : undefined;
  };

  // A run the user has already moved past: another process started, or the
  // state machine left the step this one is finishing.
  const runIsStale = (processRunId: number) =>
    processRunId !== activeProcessRunId ||
    processState.value.step !== 'computing';

  async function startProcess(
    algorithm: ProcessAlgorithm,
    options: { requiresActiveSegment?: boolean; label?: string } = {}
  ) {
    // Most processes operate on the active segment; all-segments processes opt
    // out so they are not blocked by a locked active segment.
    const imageId = currentImageID.value;
    if (!imageId) {
      messageStore.addError('No image to process');
      return;
    }

    edits.beforeEdit();

    const resolved = resolveRun(
      imageId,
      options.requiresActiveSegment !== false
    );
    if (!resolved) return;
    const { targets, watchedMaskId } = resolved;

    const label = options.label ?? 'Process';
    const processRunId = ++activeProcessRunId;

    const written: PreviewRun[] = [];

    const targetedState = {
      activeParentImageID: imageId,
      watchedMaskId,
      targetMaskIds: targets.map((target) => target.maskId),
    };
    edits.hold(cancelProcess);
    paintStore.enterProcessMode();
    processState.value = { step: 'computing', ...targetedState };

    try {
      // Started together, so every algorithm reads its own mask before any
      // result is written back: each run sees the state the user acted on.
      const outputs = await Promise.all(
        targets.map((input) =>
          algorithm(structuredClone(omit(input, 'voxels')))
        )
      );

      if (runIsStale(processRunId)) return;

      const runs = targets.flatMap((target, index) =>
        buildRun(target, outputs[index])
      );

      // No segment came back with anything to write: every mask was deleted
      // while the algorithm ran, or the algorithm had nothing to do to any of
      // them. There is then nothing to preview and nothing to roll back.
      if (runs.length === 0) {
        warnIfNothingProcessed(outputs, label);
        endRun();
        return;
      }

      // Masked against what the segments hold now, so a run that reaches a
      // voxel an earlier run of the same pass just filled leaves it there.
      runs.forEach((run) => {
        run.target.voxels.ensureContains(run.extent);
        maskVoxelsOtherSegmentsHold(run);
        run.target.voxels.apply(run.processedScalars);
        written.push(run);
      });

      processState.value = {
        step: 'previewing',
        ...targetedState,
        runs,
        showingOriginal: false,
      };
    } catch (error) {
      if (runIsStale(processRunId)) return;

      messageStore.addError(`${label} Operation Failed`, {
        error: error as Error,
      });
      // Only the masks this run wrote are restored, each still at its run's
      // extent. A target it never wrote holds exactly what the user left
      // there, and writing a snapshot back would invalidate its renderer for
      // nothing.
      written.forEach((run) =>
        writeIfPresent(run.target.voxels, run.originalScalars)
      );
      endRun();
    }
  }

  /**
   * Shows the original or the processed result, stated rather than flipped:
   * the buttons that offer the two name the one they show, so re-clicking the
   * one already showing has to leave the preview alone.
   */
  function setShowingOriginal(showOriginal: boolean) {
    const state = processState.value;

    if (state.step === 'previewing' && state.showingOriginal !== showOriginal) {
      state.runs.forEach((run) =>
        writeIfPresent(
          run.target.voxels,
          showOriginal ? run.originalScalars : run.processedScalars
        )
      );

      processState.value = {
        ...state,
        showingOriginal: showOriginal,
      };
    }
  }

  watch(
    () => paintStore.activeMode,
    (mode, previousMode) => {
      if (previousMode !== PaintMode.Process || mode === PaintMode.Process) {
        return;
      }
      if (!runInFlight()) return;
      cancelProcess();
    }
  );

  // A preview belongs to the paint tool: putting the brush down hands the
  // segment to another tool, which is free to grow the mask the preview holds
  // a snapshot of.
  watch(
    () => paintStore.isActive,
    (isActive) => {
      if (isActive || !runInFlight()) return;
      cancelProcess();
    }
  );

  // A segment-scoped run belongs to the segment it was started on, so
  // selecting another throws it away. An all-segments run watches nothing and
  // outlives the selection changing under it.
  watch(
    () => segmentRegistry.selectedSegmentId.value,
    (segmentId) => {
      const state = runInFlight();
      if (!state) return;
      const watched = state.watchedMaskId;
      if (watched === undefined) return;
      if (
        segmentationStore.maskExists(watched) &&
        segmentationStore.getMask(watched).segmentId === segmentId
      )
        return;
      cancelProcess();
    }
  );

  // Cancel process when current image changes
  watch(currentImageID, (newVal) => {
    const state = runInFlight();
    if (state && state.activeParentImageID !== newVal) cancelProcess();
  });

  return {
    processState,
    processStep,
    activeProcessType,
    showingOriginal,
    setActiveProcessType,
    startRefusal,
    startProcess,
    confirmProcess,
    cancelProcess,
    setShowingOriginal,
  };
});
