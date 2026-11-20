import { defineStore } from 'pinia';
import { ref } from 'vue';

import { NO_NAME } from '@/src/constants';
import { allocateMask } from '@/src/segmentation/masks/storage';
import { createVoxelAccess } from '@/src/segmentation/masks/voxelAccess';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe, ProcessingResultSource } from '@/src/types';
import { maskScalars } from '@/src/segmentation/model';
import {
  emptyExtent,
  extentContainsIndex,
  hasMarkedVoxel,
  maskOffset,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { boundScalars } from '@/src/segmentation/masks/overlap';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useSegmentStore } from '@/src/segmentation/segments';

/**
 * Voxel operations over the masks each image's segment set holds, addressed by
 * segment id: allocation, access, edit targets and cleanup.
 */
export const useSegmentationStore = defineStore('segmentation', () => {
  const edits = useSegmentationEditsStore();
  const imageCacheStore = useImageCacheStore();
  const segmentRegistry = useSegmentStore().segments;
  const { maskOf, imageMasks } = segmentRegistry;

  /** The image whose grid a segment's voxels sit on. */
  function parentImageOf(segmentId: string) {
    const imageId = segmentRegistry.ownerImageId(segmentId);
    const image = imageId && imageCacheStore.getVtkImageData(imageId);
    if (!image) throw new Error('No such parent image');
    return image;
  }

  /** What the image's segmentation files are labelled by default. */
  const segmentationName = (imageId: string) =>
    imageCacheStore.getImageMetadata(imageId)?.name ?? NO_NAME;

  /** Allocates a segment's mask on the parent's grid, covering `extent`. */
  function allocateSegmentMask(
    segmentId: string,
    extent: Extent3D,
    source?: ProcessingResultSource
  ) {
    if (!segmentRegistry.ownerImageId(segmentId))
      throw new Error('No such segment');
    if (maskOf(segmentId)) throw new Error('Segment already has a mask');
    return segmentRegistry.setMask(segmentId, {
      image: allocateMask(parentImageOf(segmentId), extent),
      extent,
      ...(source ? { source } : {}),
    });
  }

  // `locked` is required, so a per-stroke read skips resolving the appearance.
  const isLocked = (segmentId: Maybe<string>) =>
    segmentRegistry.getSegment(segmentId)?.locked ?? false;

  const saveFormat = ref('vti');

  /** The single voxel-allocation point for edits, which grow it from nothing. */
  const materializeMask = (segmentId: string) =>
    maskOf(segmentId) ?? allocateSegmentMask(segmentId, emptyExtent());

  // Editor state, not document state: it is never serialized.
  const allowOverlap = ref(false);

  const { maskVoxels, findMaskVoxels, voxelClaim } = createVoxelAccess({
    parentImageOf,
    segmentExists: (segmentId) => !!segmentRegistry.getSegment(segmentId),
    maskOf,
    materializeMask,
    siblingMasks: (segmentId) =>
      imageMasks(segmentRegistry.ownerImageId(segmentId)).filter(
        (mask) => mask.segmentId !== segmentId
      ),
    isLocked,
    overlapAllowed: () => allowOverlap.value,
  });

  /** The segments of an image a process may edit: unlocked, holding a mask. */
  const editableMasks = (parentImageId: string) =>
    imageMasks(parentImageId)
      .filter(({ segmentId }) => !isLocked(segmentId))
      .map(({ segmentId }) => segmentId);

  /**
   * The segments whose masks hold the voxel at PARENT indices i, j, k of an
   * image, in registry order: what the eyedropper picks from and the probe
   * lists. Masks share the parent grid, so one index addresses every mask.
   */
  const segmentsAt = (parentImageId: string, i: number, j: number, k: number) =>
    imageMasks(parentImageId)
      .filter(({ binding }) => {
        const bounded = boundScalars(binding);
        return (
          !!bounded &&
          extentContainsIndex(bounded.extent, i, j, k) &&
          bounded.scalars[maskOffset(bounded, i, j, k)] === SEGMENT_VALUE
        );
      })
      .map(({ segmentId }) => segmentId);

  /**
   * Deletes each of these segments' masks that holds no voxel, since an erase
   * never shrinks the allocation that content is read from. Edits call it once
   * they end, with the segments they wrote or cleared; a mask already gone is
   * skipped. The segments stay.
   */
  function deleteEmptyMasks(segmentIds: Iterable<string>) {
    new Set(segmentIds).forEach((segmentId) => {
      const binding = maskOf(segmentId);
      if (binding && !hasMarkedVoxel(maskScalars(binding.image)))
        segmentRegistry.removeMask(segmentId);
    });
  }

  // --- edit targets --- //

  // A segment the caller named that no longer exists is a stale reference, not
  // a target: the edit falls through to the selected one.
  const targetSegmentId = (
    imageId: string,
    preferredSegmentId: Maybe<string>
  ) => {
    if (preferredSegmentId && segmentRegistry.getSegment(preferredSegmentId)) {
      segmentRegistry.assertBelongsToImage(imageId, preferredSegmentId);
      return preferredSegmentId;
    }
    return segmentRegistry.selectedSegmentId(imageId);
  };

  /**
   * The segment an edit would land in, if it already has a mask. Creates
   * nothing, so an operation with nothing to allocate for, erasing above all,
   * can refuse before anything is created.
   */
  function findEditTarget(imageId: string, preferredSegmentId?: Maybe<string>) {
    const segmentId = targetSegmentId(imageId, preferredSegmentId);
    return segmentId && maskOf(segmentId) ? segmentId : undefined;
  }

  /**
   * Whether the segment an edit would land in is locked, answered from the
   * segment alone and creating nothing, so every edit path can refuse first.
   */
  const editTargetLocked = (
    imageId: string,
    preferredSegmentId?: Maybe<string>
  ) => isLocked(targetSegmentId(imageId, preferredSegmentId));

  /**
   * The segment an edit targets. With no segments the first edit mints one.
   * Allocates no voxels; callers refusing a locked segment ask
   * `editTargetLocked` before this.
   */
  function resolveEditTarget(
    imageId: string,
    preferredSegmentId?: Maybe<string>
  ) {
    edits.beforeEdit();
    return (
      targetSegmentId(imageId, preferredSegmentId) ??
      segmentRegistry.ensureSelectedSegment(imageId)
    );
  }

  return {
    maskOf,
    imageMasks,
    segmentationName,
    findEditTarget,
    resolveEditTarget,
    editTargetLocked,
    maskVoxels,
    findMaskVoxels,
    allocateSegmentMask,
    materializeMask,
    isLocked,
    saveFormat,
    allowOverlap,
    voxelClaim,
    deleteEmptyMasks,
    editableMasks,
    segmentsAt,
  };
});
