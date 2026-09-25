import { markRaw } from 'vue';
import { until } from '@vueuse/core';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import type { Segmentation } from '@/src/io/state-file/schema';
import { placeMask, setMaskScalars } from '@/src/segmentation/masks/storage';
import type { ProcessingResultSource } from '@/src/types';
import {
  LABELMAP_BACKGROUND_VALUE,
  maskScalars,
  type LabelmapBinding,
} from '@/src/segmentation/model';
import {
  extentContains,
  extentSize,
  fullExtent,
  isEmptyExtent,
  type Extent3D,
} from '@/src/segmentation/geometry';
import { arrayEquals } from '@/src/utils';
import type vtkLabelMap from '@/src/vtk/LabelMap';

export type WireMask = Segmentation['masks'][number];

export function createLoadedImageReader(
  getImage: (id: string) => ProgressiveImage | undefined,
  getVtkImageData: (id: string) => vtkImageData | undefined
) {
  return async (imageId: string) => {
    // A stopped, incomplete load cannot supply the grid for an input.
    // Removal also settles the watcher, including removal before it starts.
    await until(() => !getImage(imageId)?.loading.value).toBe(true);
    if (getImage(imageId)?.status.value !== 'complete') {
      throw new Error('Labelmap image did not load');
    }
    const image = getVtkImageData(imageId);
    if (!image) throw new Error('Could not get input image data');
    return image;
  };
}

export type LoadedLabelmap = {
  labelmap: vtkLabelMap;
  name: string;
  source?: ProcessingResultSource;
};

export type SkippedRestoreItem = { name: string; reason: string };

type RestoreBindingInput = {
  manifest: { segmentations?: Segmentation[] };
  dataIDMap: Record<string, string>;
  /**
   * What each mask's own archive entry held. A mask awaiting an input's
   * split is absent: its voxels are still inside that input.
   */
  loaded: Map<WireMask, LoadedLabelmap>;
  getParentImage: (id: string) => vtkImageData | undefined;
};

const sameDimensions = (extent: Extent3D, dimensions: number[]) =>
  arrayEquals(extentSize(extent), dimensions);

function validExtent(
  extent: Extent3D,
  labelmap: vtkLabelMap,
  parentImage: vtkImageData,
  reject: (reason: string) => void
) {
  if (isEmptyExtent(extent)) {
    const containsForeground = maskScalars(labelmap).some(
      (value) => value !== LABELMAP_BACKGROUND_VALUE
    );
    if (!containsForeground) return true;
    reject('empty extent references a mask with foreground voxels');
    return false;
  }

  if (!sameDimensions(extent, labelmap.getDimensions())) {
    reject('extent does not match the loaded mask dimensions');
    return false;
  }
  if (!extentContains(fullExtent(parentImage.getDimensions()), extent)) {
    reject('extent leaves the parent image');
    return false;
  }
  return true;
}

/**
 * Places each loaded mask on its parent's grid at the bounds its binding
 * claims, refusing bounds the labelmap or the image does not support. Nothing
 * is shared: a mask that fails validation leaves every other mask alone,
 * because each one was read into a buffer of its own.
 */
export function prepareRestoreBindings(input: RestoreBindingInput) {
  const { manifest, dataIDMap, loaded, getParentImage } = input;
  const acceptedBindings = new WeakMap<WireMask, LabelmapBinding>();
  const skipped: SkippedRestoreItem[] = [];

  const place = (wireMask: WireMask, parentImage: vtkImageData | undefined) => {
    const wireBinding = wireMask.representations.labelmap;
    const available = loaded.get(wireMask);
    if (!wireBinding || !available) return;

    const { name, labelmap, source } = available;
    const reject = (reason: string) => skipped.push({ name, reason });

    if (!parentImage) {
      reject('parent image data is unavailable');
      return;
    }

    const extent = [...wireBinding.extent] as Extent3D;
    if (!validExtent(extent, labelmap, parentImage, reject)) return;

    placeMask(labelmap, parentImage, extent);
    if (isEmptyExtent(extent)) setMaskScalars(labelmap, new Uint8Array(0));
    acceptedBindings.set(wireMask, {
      image: markRaw(labelmap),
      extent,
      name,
      ...(source ? { source } : {}),
    });
  };

  (manifest.segmentations ?? []).forEach((wire) => {
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
