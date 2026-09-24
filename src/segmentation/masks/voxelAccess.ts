import type { TypedArray } from '@kitware/vtk.js/types';

import type { Maybe } from '@/src/types';
import type { VoxelGesture } from '@/src/segmentation/model';
import type { useImageCacheStore } from '@/src/store/image-cache';
import { regrowMask } from '@/src/segmentation/masks/storage';
import {
  boundScalars,
  masksClearing,
  masksHolding,
} from '@/src/segmentation/masks/overlap';
import {
  listMasks,
  maskScalars,
  type LabelmapBinding,
  type MaskVoxelAccessor,
  type SegmentMask,
  type Segmentation,
  type VoxelStorage,
} from '@/src/segmentation/model';
import {
  clipExtent,
  extentContains,
  extentUnion,
  fullExtent,
  isEmptyExtent,
  padExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';

export type VoxelAccessDeps = {
  imageCacheStore: ReturnType<typeof useImageCacheStore>;
  findMask: (maskId: string) => SegmentMask | undefined;
  getMask: (maskId: string) => SegmentMask;
  segmentationOfMask: (maskId: string) => Segmentation | undefined;
  ensureLabelmapBinding: (maskId: string) => LabelmapBinding;
  maskLocked: (mask: SegmentMask) => boolean;
  overlapAllowed: () => boolean;
};

/**
 * Reading and growing the voxels behind a mask. Split out so the store holds
 * the records; every accessor re-resolves its binding rather than capturing a
 * buffer, so none of them outlive a mask they were made for.
 */
export function createVoxelAccess(deps: VoxelAccessDeps) {
  const {
    imageCacheStore,
    findMask,
    getMask,
    segmentationOfMask,
    ensureLabelmapBinding,
    maskLocked,
    overlapAllowed,
  } = deps;

  function requireParentImage(maskId: string) {
    const segmentation = segmentationOfMask(maskId);
    if (!segmentation) throw new Error('No such segment');
    const parent = imageCacheStore.getVtkImageData(segmentation.parentImageId);
    if (!parent) throw new Error('No such parent image');
    return parent;
  }

  /**
   * Grows one mask, in place, to cover `extent` in parent index space, with
   * `padding` voxels of room beyond it when it has to grow at all.
   */
  function ensureMaskContains(maskId: string, extent: Extent3D, padding = 0) {
    if (isEmptyExtent(extent)) return false;

    const binding = getMask(maskId).representations.labelmap;
    if (!binding) throw new Error('No storage: call materialize() first');
    const parent = requireParentImage(maskId);
    // Refused before anything is touched, so a rejected growth leaves the mask
    // exactly as it was.
    const parentExtent = fullExtent(parent.getDimensions());
    if (!extentContains(parentExtent, extent))
      throw new Error('Extent leaves the parent image');

    const current = binding.extent;
    if (!isEmptyExtent(current) && extentContains(current, extent))
      return false;

    const requested = clipExtent(padExtent(extent, padding), parentExtent);
    const grown = isEmptyExtent(current)
      ? requested
      : extentUnion(current, requested);
    regrowMask(binding.image, parent, current, grown);
    binding.extent = grown;
    return true;
  }

  /**
   * The voxel half of the accessor seam, over whichever mask `findBinding`
   * resolves. Resolution is deferred to every call so a stale accessor sees
   * deletion or growth done through another one. `onMissing` names why storage
   * is unreachable, so `exists()` can answer without throwing.
   */
  function voxelStorage(
    maskId: string,
    findBinding: () => Maybe<LabelmapBinding>,
    onMissing: () => never
  ): VoxelStorage {
    const findImage = () => findBinding()?.image;
    const requireImage = () => findImage() ?? onMissing();
    const requireScalars = () => maskScalars(requireImage());

    return {
      exists: () => !!findImage(),
      image: requireImage,
      scalars: requireScalars,
      snapshot: () => requireScalars().slice(),
      apply: (scalars: TypedArray | number[]) => {
        const image = requireImage();
        const data = maskScalars(image);
        if (scalars.length !== data.length) {
          throw new Error('Scalar length does not match storage');
        }
        data.set(scalars);
        image.modified();
      },
      ensureContains: (extent: Extent3D, padding = 0) => {
        requireImage();
        return ensureMaskContains(maskId, extent, padding);
      },
    };
  }

  function maskVoxels(maskId: string): MaskVoxelAccessor {
    // Validates eagerly: an accessor for a nonexistent segment is refused up
    // front, not just on first use.
    getMask(maskId);

    const binding = () => getMask(maskId).representations.labelmap;

    // Deliberately tolerant where binding() is not: the segment itself can be
    // deleted out from under an accessor, and that is an absent storage, not a
    // lookup error.
    const findBinding = () => findMask(maskId)?.representations.labelmap;

    const onMissing = (): never => {
      throw new Error('No storage: call materialize() first');
    };

    return {
      binding,
      materialize: () => ensureLabelmapBinding(maskId),
      ...voxelStorage(maskId, findBinding, onMissing),
    };
  }

  /**
   * The accessor for consumers holding an id a segment may already have left:
   * the renderer and the paint widget are computeds keyed on one that can
   * vanish a tick before they do, so this stays constructible either way.
   */
  const findMaskVoxels = (maskId: string) =>
    voxelStorage(
      maskId,
      () => findMask(maskId)?.representations.labelmap,
      () => {
        throw new Error('No such segment');
      }
    );

  /** A bound segment's buffer, absent when it has none or holds nothing. */
  const boundedMask = (binding?: LabelmapBinding) =>
    binding && boundScalars(binding.image, binding.extent);

  /**
   * The masks of an image's other segments, split by what `gesture` does where
   * one of them holds a voxel: take the voxel from it, or yield to it and leave
   * the voxel unwritten. Resolved once per run because the caller below runs
   * per voxel. A locked segment is not editable, so an aimed gesture yields to
   * it rather than taking from it.
   */
  function siblingMasks(maskId: string, gesture: VoxelGesture) {
    const segmentation = segmentationOfMask(maskId);
    const others =
      segmentation && !(gesture === 'aimed' && overlapAllowed())
        ? listMasks(segmentation).filter((segment) => segment.id !== maskId)
        : [];
    const takes = (segment: SegmentMask) =>
      gesture === 'aimed' && !maskLocked(segment);
    const bounded = (segments: SegmentMask[]) =>
      segments.flatMap((segment) => {
        const mask = boundedMask(segment.representations.labelmap);
        return mask ? [mask] : [];
      });
    return {
      takeFrom: bounded(others.filter(takes)),
      yieldTo: bounded(others.filter((segment) => !takes(segment))),
    };
  }

  /**
   * Whether the voxel at PARENT indices i, j, k is this segment's to write,
   * clearing it from the neighbours that have to give it up. Asked before the
   * write: a voxel a neighbour it yields to holds is refused and taken from
   * nobody.
   * Absent when no other segment reaches `within`, the box the caller is about
   * to walk: every voxel in it is then uncontested.
   *
   * `gesture` is the whole of the policy, so see {@link VoxelGesture}. An aimed
   * operation must call finish in a finally block after its last voxel write.
   */
  function voxelClaim(maskId: string, gesture: VoxelGesture, within: Extent3D) {
    const { takeFrom, yieldTo } = siblingMasks(maskId, gesture);
    const held = masksHolding(yieldTo, within);
    const clearing = masksClearing(takeFrom, within);
    if (!held && !clearing) return undefined;
    return {
      claim: (i: number, j: number, k: number) =>
        !held?.(i, j, k) && (clearing?.claim(i, j, k) ?? true),
      finish: () => clearing?.finish(),
    };
  }

  return {
    requireParentImage,
    ensureMaskContains,
    maskVoxels,
    findMaskVoxels,
    boundedMask,
    siblingMasks,
    voxelClaim,
  };
}
