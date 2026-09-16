import { markRaw } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import type { Segmentation } from '@/src/io/state-file/schema';
import { placeMask, setMaskScalars } from '@/src/segmentation/masks/storage';
import { maskScalars, type LabelmapBinding } from '@/src/segmentation/model';
import {
  extentContains,
  extentSize,
  fullExtent,
  hasMarkedVoxel,
  isEmptyExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { arrayEquals } from '@/src/utils';
import type vtkLabelMap from '@/src/vtk/LabelMap';

export type WireMask = Segmentation['masks'][number];

export type SkippedRestoreItem = { name: string; reason: string };

type RestoreBindingInput = {
  segmentations: Segmentation[];
  dataIDMap: Record<string, string>;
  /**
   * What each mask's own archive entry held. A mask awaiting an input's
   * split is absent: its voxels are still inside that input.
   */
  loaded: Map<WireMask, vtkLabelMap>;
  getParentImage: (id: string) => vtkImageData | undefined;
};

function extentProblem(
  extent: Extent3D,
  labelmap: vtkLabelMap,
  parentImage: vtkImageData
) {
  if (!extent.every(Number.isInteger))
    return 'extent coordinates must be finite integers';
  if (isEmptyExtent(extent))
    return hasMarkedVoxel(maskScalars(labelmap))
      ? 'empty extent references a mask with foreground voxels'
      : undefined;
  if (!arrayEquals(extentSize(extent), labelmap.getDimensions()))
    return 'extent does not match the loaded mask dimensions';
  if (!extentContains(fullExtent(parentImage.getDimensions()), extent))
    return 'extent leaves the parent image';
  return undefined;
}

/**
 * Places each loaded mask on its parent's grid at the bounds its binding
 * claims, refusing bounds the labelmap or the image does not support. Nothing
 * is shared: a mask that fails validation leaves every other mask alone,
 * because each one was read into a buffer of its own.
 */
export function prepareRestoreBindings(input: RestoreBindingInput) {
  const { segmentations, dataIDMap, loaded, getParentImage } = input;
  const acceptedBindings = new WeakMap<WireMask, LabelmapBinding>();
  const skipped: SkippedRestoreItem[] = [];

  const place = (wireMask: WireMask, parentImage: vtkImageData | undefined) => {
    const wireBinding = wireMask.representations.labelmap;
    const labelmap = loaded.get(wireMask);
    if (!wireBinding || !labelmap) return;

    const name = wireBinding.name ?? '';
    const { source } = wireBinding;
    const reject = (reason: string) =>
      skipped.push({ name: name || wireBinding.path, reason });

    if (!parentImage) {
      reject('parent image data is unavailable');
      return;
    }

    const extent = [...wireBinding.extent] as Extent3D;
    const problem = extentProblem(extent, labelmap, parentImage);
    if (problem) {
      reject(problem);
      return;
    }

    placeMask(labelmap, parentImage, extent);
    if (isEmptyExtent(extent)) setMaskScalars(labelmap, new Uint8Array(0));
    acceptedBindings.set(wireMask, {
      image: markRaw(labelmap),
      extent,
      name,
      ...(source ? { source } : {}),
    });
  };

  segmentations.forEach((wire) => {
    const parentImageId = dataIDMap[wire.parentImage];
    // A parent the restore never mapped is as unavailable as one whose data
    // did not load, and reports the same way rather than dropping its masks in
    // silence: losing masks must read differently from having none.
    const parentImage =
      parentImageId === undefined ? undefined : getParentImage(parentImageId);
    orderedWireMasks(wire).forEach((wireMask) => place(wireMask, parentImage));
  });

  return { acceptedBindings, skipped };
}

export function orderedWireMasks<T extends { id: string }>(wire: {
  masks: T[];
  order: string[];
}) {
  const byId = new Map(wire.masks.map((mask) => [mask.id, mask]));
  return wire.order.flatMap((maskId) => {
    const mask = byId.get(maskId);
    return mask ? [mask] : [];
  });
}

/** Masks a wire holds but its order leaves out: restore places none of them. */
export function unlistedWireMasks<T extends { id: string }>(wire: {
  masks: T[];
  order: string[];
}) {
  const listed = new Set(wire.order);
  return wire.masks.filter((mask) => !listed.has(mask.id));
}
