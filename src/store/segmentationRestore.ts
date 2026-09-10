import { markRaw } from 'vue';
import { until } from '@vueuse/core';
import type { ProgressiveImage } from '@/src/core/progressiveImage';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import type {
  Manifest,
  SegmentationArtifact,
} from '@/src/io/state-file/schema';
import { placeMask, setMaskScalars } from '@/src/store/segmentMask';
import type { ProcessingResultSource } from '@/src/types';
import {
  extentContains,
  extentSize,
  fullExtent,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  maskScalars,
  type Extent3D,
  type LabelmapBinding,
} from '@/src/types/segmentation';
import { arrayEquals } from '@/src/utils';
import type vtkLabelMap from '@/src/vtk/LabelMap';

type WireMaskation = NonNullable<Manifest['segmentations']>[number];
export type WireMask = WireMaskation['masks'][number];

/**
 * Every artifact is split into bounded masks. One the manifest's masks name
 * takes its segments from them; one nothing names carries no account of what
 * its values mean, so the restore enumerates its voxels instead.
 */
export function planArtifactRestore(manifest: Manifest) {
  const boundArtifactIds = new Set(
    (manifest.segmentations ?? []).flatMap((wire) =>
      wire.masks.flatMap((segment) => {
        const artifactId = segment.representations.labelmap?.artifactId;
        return artifactId ? [artifactId] : [];
      })
    )
  );
  const needsDecode = (artifact: SegmentationArtifact) =>
    artifact.pendingDecode === true || !boundArtifactIds.has(artifact.id);
  return { needsDecode };
}

/** Requires complete image data for an artifact's source or parent grid. */
export function createArtifactImageLoader(
  getImage: (id: string) => ProgressiveImage | undefined,
  getVtkImageData: (id: string) => vtkImageData | undefined
) {
  return async (imageId: string) => {
    // A stopped, incomplete load cannot supply the grid for an artifact.
    // Removal also settles the watcher, including removal before it starts.
    await until(() => !getImage(imageId)?.loading.value).toBe(true);
    if (getImage(imageId)?.status.value !== 'complete') {
      throw new Error('Artifact image did not load');
    }
    const image = getVtkImageData(imageId);
    if (!image) throw new Error('Could not get artifact image data');
    return image;
  };
}

/**
 * An artifact is split in the parent's index space, so it goes onto the
 * parent's grid first. A saved mask needs none of this: it carries its own
 * bounds and its file is already the shape they describe.
 */
export async function restoredLabelmapImage(
  artifact: SegmentationArtifact,
  image: vtkImageData,
  deps: {
    loadedParentImage: (
      artifact: SegmentationArtifact
    ) => Promise<vtkImageData>;
    ensureSameSpace: (
      fixed: vtkImageData,
      moving: vtkImageData,
      nearestNeighbor: boolean
    ) => Promise<vtkImageData>;
  }
) {
  return deps.ensureSameSpace(
    await deps.loadedParentImage(artifact),
    image,
    true
  );
}

/** One mask's labelmap, read back from the archive entry its binding named. */
export type LoadedLabelmap = {
  labelmap: vtkLabelMap;
  name: string;
  source?: ProcessingResultSource;
};

export type SkippedRestoreItem = { name: string; reason: string };

type RestoreBindingInput = {
  manifest: Manifest;
  dataIDMap: Record<string, string>;
  /**
   * What each mask's own archive entry held. A mask awaiting an artifact's
   * split is absent: its voxels are still inside that artifact.
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
    if (parentImageId === undefined) return;
    const parentImage = getParentImage(parentImageId);
    orderedWireMasks(wire).forEach((wireMask) => place(wireMask, parentImage));
  });

  return { acceptedBindings, skipped };
}

/** The wire's masks in the order it records, skipping ids it does not name. */
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
