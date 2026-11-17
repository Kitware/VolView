import { markRaw } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import type {
  PlannedMask,
  PlannedSegmentation,
} from '@/src/io/import/labelmapImports';
import { placeMask } from '@/src/segmentation/masks/storage';
import type { LabelmapBinding } from '@/src/segmentation/model';
import {
  extentContains,
  extentSize,
  fullExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { arrayEquals } from '@/src/utils';
import type vtkLabelMap from '@/src/vtk/LabelMap';

export type SkippedRestoreItem = { name: string; reason: string };

type RestoreBindingInput = {
  segmentations: PlannedSegmentation[];
  dataIDMap: Record<string, string>;
  /**
   * What each mask's own archive entry held. A mask awaiting an input's
   * split is absent: its voxels are still inside that input.
   */
  loaded: Map<PlannedMask, vtkLabelMap>;
  label: (mask: PlannedMask) => string;
  getParentImage: (id: string) => vtkImageData | undefined;
};

function extentProblem(
  extent: Extent3D,
  labelmap: vtkLabelMap,
  parentImage: vtkImageData
) {
  if (!extent.every(Number.isInteger))
    return 'extent coordinates must be finite integers';
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
  const { segmentations, dataIDMap, loaded, label, getParentImage } = input;
  const acceptedBindings = new WeakMap<PlannedMask, LabelmapBinding>();
  const skipped: SkippedRestoreItem[] = [];

  const place = (
    wireMask: PlannedMask,
    parentImage: vtkImageData | undefined
  ) => {
    const wireBinding = wireMask.labelmap;
    const labelmap = loaded.get(wireMask);
    if (!wireBinding || !labelmap) return;

    const { source } = wireBinding;
    const reject = (reason: string) =>
      skipped.push({ name: label(wireMask), reason });

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
    acceptedBindings.set(wireMask, {
      image: markRaw(labelmap),
      extent,
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
    wire.masks.forEach((wireMask) => place(wireMask, parentImage));
  });

  return { acceptedBindings, skipped };
}
