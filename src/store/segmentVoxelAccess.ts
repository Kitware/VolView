import type { TypedArray } from '@kitware/vtk.js/types';

import type vtkLabelMap from '@/src/vtk/LabelMap';
import type { Maybe } from '@/src/types';
import type { VoxelGesture } from '@/src/store/segmentations';
import type { useImageCacheStore } from '@/src/store/image-cache';
import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import { regrowMask } from '@/src/store/segmentMask';
import {
  boundScalars,
  masksClearing,
  masksHolding,
} from '@/src/store/segmentLayers';
import {
  clipExtent,
  extentContains,
  extentUnion,
  fullExtent,
  isEmptyExtent,
  listMasks,
  maskScalars,
  padExtent,
  type ArtifactMetadata,
  type Extent3D,
  type LabelmapBinding,
  type MaskVoxelAccessor,
  type SegmentMask,
  type Segmentation,
  type VoxelStorage,
} from '@/src/types/segmentation';

/** What voxel access needs from the store that owns the records. */
export type VoxelAccessDeps = {
  artifactIndex: Record<string, vtkLabelMap>;
  artifactMeta: Record<string, ArtifactMetadata>;
  imageCacheStore: ReturnType<typeof useImageCacheStore>;
  segmentRegistry: SegmentRegistry;
  findMask: (maskId: string) => SegmentMask | undefined;
  getMask: (maskId: string) => SegmentMask;
  masksForArtifact: (artifactId: string) => SegmentMask[];
  segmentationOfMask: (maskId: string) => Segmentation | undefined;
  ensureLabelmapBinding: (maskId: string) => LabelmapBinding;
  maskLocked: (mask: SegmentMask) => boolean;
};

/**
 * Reading and growing the voxels behind a mask or an artifact. Split out so the
 * store holds the records; every accessor re-resolves its binding rather than
 * capturing a buffer, so none of them outlive a mask they were made for.
 */
export function createVoxelAccess(deps: VoxelAccessDeps) {
  const {
    artifactIndex,
    artifactMeta,
    imageCacheStore,
    findMask,
    getMask,
    masksForArtifact,
    segmentationOfMask,
    ensureLabelmapBinding,
    maskLocked,
  } = deps;

  function requireArtifactContext(artifactId: string) {
    const mask = artifactIndex[artifactId];
    const meta = artifactMeta[artifactId];
    if (!mask || !meta) throw new Error('No such artifact');
    const parent = imageCacheStore.getVtkImageData(meta.parentImage);
    if (!parent) throw new Error('No such parent image');
    return { mask, parent };
  }

  function requireArtifactBinding(artifactId: string) {
    const segment = masksForArtifact(artifactId)[0];
    const binding = segment?.representations.labelmap;
    if (!binding) throw new Error('No segment bound to this artifact');
    return binding;
  }

  /**
   * Grows one mask, in place, to cover `extent` in parent index space, with
   * `padding` voxels of room beyond it when it has to grow at all.
   */
  function ensureArtifactContains(
    artifactId: string,
    extent: Extent3D,
    padding = 0
  ) {
    if (isEmptyExtent(extent)) return false;

    const { mask, parent } = requireArtifactContext(artifactId);
    // Refused before anything is touched, so a rejected growth leaves the mask
    // exactly as it was.
    const parentExtent = fullExtent(parent.getDimensions());
    if (!extentContains(parentExtent, extent))
      throw new Error('Extent leaves the parent image');

    const binding = requireArtifactBinding(artifactId);
    const current = binding.extent;
    if (!isEmptyExtent(current) && extentContains(current, extent))
      return false;

    const requested = clipExtent(padExtent(extent, padding), parentExtent);
    const grown = isEmptyExtent(current)
      ? requested
      : extentUnion(current, requested);
    regrowMask(mask, parent, current, grown);
    binding.extent = grown;
    return true;
  }

  /**
   * The voxel half of the accessor seam, over whichever mask `findArtifactId`
   * resolves. Resolution is deferred to every call so a stale accessor sees
   * deletion or growth done through another one. `onMissing` names why storage
   * is unreachable, so `exists()` can answer without throwing.
   */
  function voxelStorage(
    findArtifactId: () => Maybe<string>,
    onMissing: () => never
  ): VoxelStorage {
    const findImage = () => {
      const artifactId = findArtifactId();
      return artifactId ? artifactIndex[artifactId] : undefined;
    };
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
        return ensureArtifactContains(findArtifactId()!, extent, padding);
      },
    };
  }

  /**
   * The accessor every labelmap consumer that holds a segment routes through.
   * The binding is re-resolved on every call rather than captured.
   */
  function maskVoxels(maskId: string): MaskVoxelAccessor {
    // Validates eagerly: an accessor for a nonexistent segment is refused up
    // front, not just on first use.
    getMask(maskId);

    const binding = () => getMask(maskId).representations.labelmap;

    // Deliberately tolerant where binding() is not: the segment itself can be
    // deleted out from under an accessor, and that is an absent storage, not a
    // lookup error.
    const findArtifactId = () =>
      findMask(maskId)?.representations.labelmap?.artifactId;

    const onMissing = (): never => {
      if (!binding()) throw new Error('No storage: call materialize() first');
      throw new Error('No such artifact');
    };

    return {
      binding,
      materialize: () => ensureLabelmapBinding(maskId),
      ...voxelStorage(findArtifactId, onMissing),
    };
  }

  /**
   * The accessor for consumers that hold an artifact and no segment. Stays
   * constructible for an artifact that is gone: the renderer and the paint
   * widget are computeds keyed on an id that can vanish a tick before they do.
   */
  function artifactVoxels(artifactId: string) {
    return voxelStorage(
      () => (artifactIndex[artifactId] ? artifactId : undefined),
      () => {
        throw new Error('No such artifact');
      }
    );
  }

  /** A bound segment's buffer, absent when it has none or holds nothing. */
  const boundedMask = (binding?: LabelmapBinding) =>
    binding && boundScalars(artifactIndex[binding.artifactId], binding.extent);

  /**
   * The masks of an image's other segments that `gesture` may take a voxel
   * from, resolved once per run because the caller below runs per voxel. A
   * locked segment is not editable, so an aimed gesture is not offered its mask
   * at all.
   */
  function siblingMasks(maskId: string, gesture: VoxelGesture) {
    const segmentation = segmentationOfMask(maskId);
    if (!segmentation) return [];
    return listMasks(segmentation).flatMap((segment) => {
      if (segment.id === maskId) return [];
      if (gesture === 'aimed' && maskLocked(segment)) return [];
      const bounded = boundedMask(segment.representations.labelmap);
      return bounded ? [bounded] : [];
    });
  }

  /**
   * Whether the voxel at PARENT indices i, j, k is this segment's to write,
   * taking it from the neighbours that have to yield it. Absent when no other
   * segment reaches `within`, the box the caller is about to walk: every voxel
   * in it is then uncontested and the question need not be asked per voxel.
   *
   * `gesture` is the whole of the policy, so see {@link VoxelGesture}.
   */
  function voxelClaim(maskId: string, gesture: VoxelGesture, within: Extent3D) {
    const masks = siblingMasks(maskId, gesture);
    if (gesture === 'aimed') return masksClearing(masks, within);
    const held = masksHolding(masks, within);
    return held && ((i: number, j: number, k: number) => !held(i, j, k));
  }

  return {
    requireArtifactContext,
    requireArtifactBinding,
    ensureArtifactContains,
    voxelStorage,
    maskVoxels,
    artifactVoxels,
    boundedMask,
    siblingMasks,
    voxelClaim,
  };
}
