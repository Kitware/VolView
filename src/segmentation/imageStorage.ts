import { markRaw, type Ref } from 'vue';

import type { Maybe } from '@/src/types';
import {
  DEFAULT_SEGMENTATION_DISPLAY,
  type ImageSegments,
  type LabelmapBinding,
  type SegmentationDisplay,
  type SegmentationDisplayPatch,
} from '@/src/segmentation/model';

type ImageStorageDeps = {
  imageSets: Ref<Record<string, ImageSegments>>;
  setOf: (segmentId: Maybe<string>) => ImageSegments | undefined;
  ensureSet: (imageId: string) => ImageSegments;
  beforeMaskRemoval: () => void;
};

/** What an image stores beside its segment definitions: masks and display. */
export function createImageStorage({
  imageSets,
  setOf,
  ensureSet,
  beforeMaskRemoval,
}: ImageStorageDeps) {
  const maskOf = (segmentId: Maybe<string>) =>
    segmentId ? setOf(segmentId)?.masks.get(segmentId) : undefined;

  /** The image's masks in segment order. */
  const imageMasks = (imageId: Maybe<string>) => {
    const set = imageId ? imageSets.value[imageId] : undefined;
    if (!set) return [];
    return set.order.flatMap((segmentId) => {
      const binding = set.masks.get(segmentId);
      return binding ? [{ segmentId, binding }] : [];
    });
  };

  const allMasks = () => Object.keys(imageSets.value).flatMap(imageMasks);

  /** Seats prepared storage as the segment's mask; a segment holds one. */
  const setMask = (segmentId: string, binding: LabelmapBinding) => {
    const set = setOf(segmentId);
    if (!set?.segments[segmentId]) throw new Error('No such segment');
    if (set.masks.has(segmentId)) throw new Error('Segment already has a mask');
    set.masks.set(segmentId, {
      ...binding,
      image: markRaw(binding.image),
      extent: [...binding.extent],
    });
    return set.masks.get(segmentId)!;
  };

  /** The mask holds this segment and nothing else, so its voxels go with it. */
  const removeMask = (segmentId: string) => {
    const set = setOf(segmentId);
    if (!set?.masks.has(segmentId)) return;
    beforeMaskRemoval();
    set.masks.delete(segmentId);
  };

  // The image is going, so its masks leave without being removed one by one.
  const forgetMasks = (set: ImageSegments) => {
    if (set.masks.size) beforeMaskRemoval();
  };

  const displayOf = (imageId: Maybe<string>) =>
    (imageId ? imageSets.value[imageId]?.display : undefined) ??
    DEFAULT_SEGMENTATION_DISPLAY;

  const updateDisplay = (imageId: string, patch: SegmentationDisplayPatch) => {
    ensureSet(imageId).display = { ...displayOf(imageId), ...patch };
  };

  /**
   * A restored display applies unless this image already shows masks or a
   * display of its own: the scene's display is the user's.
   */
  const restoreDisplay = (imageId: string, display: SegmentationDisplay) => {
    const set = ensureSet(imageId);
    if (set.display || set.masks.size) return;
    set.display = { ...display };
  };

  return {
    maskOf,
    imageMasks,
    allMasks,
    setMask,
    removeMask,
    forgetMasks,
    displayOf,
    updateDisplay,
    restoreDisplay,
  };
}
