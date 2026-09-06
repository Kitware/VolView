import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import type {
  Manifest,
  SegmentationArtifact,
} from '@/src/io/state-file/schema';
import { placeMask, setMaskScalars } from '@/src/store/segmentMask';
import {
  extentContains,
  extentSize,
  fullExtent,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  maskScalars,
  type Extent3D,
  type Segmentation,
} from '@/src/types/segmentation';
import { arrayEquals } from '@/src/utils';
import type vtkLabelMap from '@/src/vtk/LabelMap';

type WireSegmentation = NonNullable<Manifest['segmentations']>[number];
type WireSegment = WireSegmentation['segments'][number];

/**
 * An artifact no segment binds is enumerated like a legacy descriptor-less
 * group: a composed manifest may carry a labelmap on its own.
 */
export function planArtifactRestore(manifest: Manifest) {
  const boundArtifactIds = new Set(
    (manifest.segmentations ?? []).flatMap((wire) =>
      wire.segments.flatMap((segment) =>
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

/**
 * Remaps a restored segment's label value when it collides with one the
 * parent segmentation already holds, tracking the mapping so its mask bytes
 * can be rewritten once every segment sharing it has a value. A group
 * awaiting its split keeps the SOURCE value its descriptor names.
 */
export function createLabelRemapper(
  artifactsToSplit: Set<string>,
  nextLabelValue: (segmentation: Segmentation, preferred?: number) => number,
  maxValue: number
) {
  const relabels = new Map<string, Map<number, number>>();
  const remap = (
    segmentation: Segmentation,
    artifactId: string,
    wireValue: number,
    reject: (reason: string) => void
  ) => {
    if (
      !Number.isInteger(wireValue) ||
      wireValue <= LABELMAP_BACKGROUND_VALUE ||
      wireValue > maxValue
    ) {
      reject('invalid label value');
      return undefined;
    }
    if (artifactsToSplit.has(artifactId)) return wireValue;
    try {
      const labelValue = nextLabelValue(segmentation, wireValue);
      const mapping = relabels.get(artifactId) ?? new Map<number, number>();
      mapping.set(wireValue, labelValue);
      relabels.set(artifactId, mapping);
      return labelValue;
    } catch {
      reject('no label value left on the parent image');
      return undefined;
    }
  };
  return { relabels, remap };
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

export type AcceptedRestoreBinding = {
  artifactId: string;
  extent: Extent3D;
};

export type SkippedRestoreItem = { name: string; reason: string };

type BindingCandidate = {
  wireSegment: WireSegment;
  artifactId: string;
  name: string;
  extent: Extent3D;
  parentImage: vtkImageData;
};

type RestoreBindingInput = {
  manifest: Manifest;
  dataIDMap: Record<string, string>;
  artifactIdMap: Record<string, string>;
  artifactsToSplit: Set<string>;
  artifactParentById: Record<string, string>;
  artifactImages: Record<string, vtkLabelMap>;
  getParentImage: (id: string) => vtkImageData | undefined;
};

type RestoreBindingState = RestoreBindingInput & {
  artifactNameByWireId: Map<string, string>;
  acceptedBindings: WeakMap<WireSegment, AcceptedRestoreBinding>;
  skipped: SkippedRestoreItem[];
};

const sameDimensions = (extent: Extent3D, dimensions: number[]) =>
  arrayEquals(extentSize(extent), dimensions);

function validExtent(
  extent: Extent3D,
  labelmap: vtkLabelMap | undefined,
  parentImage: vtkImageData,
  reject: (reason: string) => void
) {
  if (isEmptyExtent(extent)) {
    const containsForeground = labelmap
      ? maskScalars(labelmap).some(
          (value) => value !== LABELMAP_BACKGROUND_VALUE
        )
      : true;
    if (!containsForeground) return true;
    reject('empty extent references a mask with foreground voxels');
    return false;
  }

  const dimensions = labelmap?.getDimensions();
  if (!dimensions || !sameDimensions(extent, dimensions)) {
    reject('extent does not match the loaded mask dimensions');
    return false;
  }
  if (!extentContains(fullExtent(parentImage.getDimensions()), extent)) {
    reject('extent leaves the parent image');
    return false;
  }
  return true;
}

function candidateFor(
  wireSegment: WireSegment,
  parentImageId: string,
  parentImage: vtkImageData | undefined,
  state: RestoreBindingState
) {
  const binding = wireSegment.representations.labelmap;
  const artifactId = binding
    ? state.artifactIdMap[binding.artifactId]
    : undefined;
  if (!binding || artifactId === undefined) return undefined;

  const extent = [...binding.extent] as Extent3D;
  // The artifact is what the user recognizes; a record has no name of its own.
  const name = state.artifactNameByWireId.get(binding.artifactId) ?? '';
  const reject = (reason: string) => state.skipped.push({ name, reason });

  if (state.artifactsToSplit.has(artifactId)) {
    state.acceptedBindings.set(wireSegment, { artifactId, extent });
    return undefined;
  }
  if (state.artifactParentById[artifactId] !== parentImageId) {
    reject('artifact belongs to another image');
    return undefined;
  }
  if (!parentImage) {
    reject('parent image data is unavailable');
    return undefined;
  }
  if (
    !validExtent(extent, state.artifactImages[artifactId], parentImage, reject)
  ) {
    return undefined;
  }
  return { wireSegment, artifactId, name, extent, parentImage };
}

function collectCandidates(wire: WireSegmentation, state: RestoreBindingState) {
  const parentImageId = state.dataIDMap[wire.parentImage];
  if (parentImageId === undefined) return [];
  const parentImage = state.getParentImage(parentImageId);
  const wireById = new Map(
    wire.segments.map((segment) => [segment.id, segment])
  );
  return wire.order.flatMap((wireSegmentId) => {
    const wireSegment = wireById.get(wireSegmentId);
    if (!wireSegment) return [];
    const candidate = candidateFor(
      wireSegment,
      parentImageId,
      parentImage,
      state
    );
    return candidate ? [candidate] : [];
  });
}

function acceptCandidates(
  artifactId: string,
  candidates: BindingCandidate[],
  labelmap: vtkLabelMap,
  state: RestoreBindingState
) {
  const extent = candidates[0].extent;
  const agrees = candidates.every((candidate) =>
    arrayEquals(candidate.extent, extent)
  );
  if (!agrees) {
    candidates.forEach(({ name }) =>
      state.skipped.push({
        name,
        reason: 'bindings disagree on the artifact extent',
      })
    );
    return;
  }

  placeMask(labelmap, candidates[0].parentImage, extent);
  if (isEmptyExtent(extent)) setMaskScalars(labelmap, new Uint8Array(0));
  candidates.forEach(({ wireSegment, extent: acceptedExtent }) =>
    state.acceptedBindings.set(wireSegment, {
      artifactId,
      extent: acceptedExtent,
    })
  );
}

export function prepareRestoreBindings(input: RestoreBindingInput) {
  const acceptedBindings = new WeakMap<WireSegment, AcceptedRestoreBinding>();
  const skipped: SkippedRestoreItem[] = [];
  const state: RestoreBindingState = {
    ...input,
    acceptedBindings,
    skipped,
    artifactNameByWireId: new Map(
      (input.manifest.segmentationArtifacts ?? []).map((artifact) => [
        artifact.id,
        artifact.name,
      ])
    ),
  };
  const candidatesByArtifact = new Map<string, BindingCandidate[]>();

  (input.manifest.segmentations ?? []).forEach((wire) => {
    collectCandidates(wire, state).forEach((candidate) => {
      const candidates = candidatesByArtifact.get(candidate.artifactId) ?? [];
      candidates.push(candidate);
      candidatesByArtifact.set(candidate.artifactId, candidates);
    });
  });

  candidatesByArtifact.forEach((candidates, artifactId) =>
    acceptCandidates(
      artifactId,
      candidates,
      input.artifactImages[artifactId],
      state
    )
  );
  return { acceptedBindings, skipped };
}
