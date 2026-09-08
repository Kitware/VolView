import { markRaw } from 'vue';
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
type WireMask = WireMaskation['masks'][number];

/**
 * An artifact no segment binds is enumerated like a legacy descriptor-less
 * group: a composed manifest may carry a labelmap on its own.
 */
export function planArtifactRestore(manifest: Manifest) {
  const boundArtifactIds = new Set(
    (manifest.segmentations ?? []).flatMap((wire) =>
      wire.masks.flatMap((segment) =>
        segment.representations.labelmap
          ? [segment.representations.labelmap.artifactId]
          : []
      )
    )
  );
  const needsDecode = (artifact: SegmentationArtifact) =>
    artifact.pendingDecode === true ||
    (!artifact.pendingSplit && !boundArtifactIds.has(artifact.id));
  const needsSplit = (artifact: SegmentationArtifact) =>
    artifact.pendingSplit === true || needsDecode(artifact);
  return { boundArtifactIds, needsDecode, needsSplit };
}

/** Awaits and returns an artifact's parent image, or throws when it never loaded. */
export function createParentImageLoader(
  dataIDMap: Record<string, string>,
  untilLoaded: (id: string) => Promise<unknown>,
  getVtkImageData: (id: string) => vtkImageData | undefined
) {
  return async (artifact: SegmentationArtifact) => {
    const parentId = dataIDMap[artifact.parentImage];
    await untilLoaded(parentId);
    const parent = getVtkImageData(parentId);
    if (!parent) throw new Error('Could not get parent image data');
    return parent;
  };
}

/**
 * A whole-volume labelmap is split in the parent's index space, so it goes
 * onto the parent's grid first; a bounded mask carries its own placement.
 */
export async function restoredLabelmapImage(
  artifact: SegmentationArtifact,
  image: vtkImageData,
  deps: {
    needsSplit: (artifact: SegmentationArtifact) => boolean;
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
  if (!deps.needsSplit(artifact)) return image;
  return deps.ensureSameSpace(
    await deps.loadedParentImage(artifact),
    image,
    true
  );
}

/** A labelmap the restore read back, still unclaimed by any segment. */
export type LoadedLabelmap = {
  labelmap: vtkLabelMap;
  /** Store id of the image the manifest says it belongs to. */
  parentImageId: string;
  name: string;
  source?: ProcessingResultSource;
};

export type SkippedRestoreItem = { name: string; reason: string };

type RestoreBindingInput = {
  manifest: Manifest;
  dataIDMap: Record<string, string>;
  /**
   * The labelmaps that loaded, by wire id. A group awaiting its split is not
   * among them: it is not storage any one segment can take.
   */
  loaded: Map<string, LoadedLabelmap>;
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
 * Validates every reference before any labelmap is reshaped, so one malformed
 * binding cannot move or erase storage a later binding takes. A labelmap holds
 * one segment's voxels, so the first mask to claim one takes it and a second
 * claim on the same one is refused rather than sharing it.
 */
export function prepareRestoreBindings(input: RestoreBindingInput) {
  const { manifest, dataIDMap, loaded, getParentImage } = input;
  const acceptedBindings = new WeakMap<WireMask, LabelmapBinding>();
  const skipped: SkippedRestoreItem[] = [];
  const claimed = new Set<string>();

  const claim = (
    wireMask: WireMask,
    parentImageId: string,
    parentImage: vtkImageData | undefined
  ) => {
    const wireBinding = wireMask.representations.labelmap;
    if (!wireBinding) return;
    const available = loaded.get(wireBinding.artifactId);
    // Either the labelmap never loaded, or it is a group awaiting its split;
    // both are reported where they arise, not here.
    if (!available) return;

    const { name, labelmap, source } = available;
    const reject = (reason: string) => skipped.push({ name, reason });

    if (claimed.has(wireBinding.artifactId)) {
      reject('labelmap is already bound to another segment');
      return;
    }
    if (available.parentImageId !== parentImageId) {
      reject('artifact belongs to another image');
      return;
    }
    if (!parentImage) {
      reject('parent image data is unavailable');
      return;
    }

    const extent = [...wireBinding.extent] as Extent3D;
    if (!validExtent(extent, labelmap, parentImage, reject)) return;

    claimed.add(wireBinding.artifactId);
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
    orderedWireMasks(wire).forEach((wireMask) =>
      claim(wireMask, parentImageId, parentImage)
    );
  });

  return { acceptedBindings, claimed, skipped };
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
