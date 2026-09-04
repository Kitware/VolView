import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import type { Manifest } from '@/src/io/state-file/schema';
import { placeMask, setMaskScalars } from '@/src/store/segmentMask';
import {
  extentContains,
  extentSize,
  fullExtent,
  isEmptyExtent,
  LABELMAP_BACKGROUND_VALUE,
  maskScalars,
  type Extent3D,
} from '@/src/types/segmentation';
import type vtkLabelMap from '@/src/vtk/LabelMap';

type WireSegmentation = NonNullable<Manifest['segmentations']>[number];
type WireSegment = WireSegmentation['segments'][number];

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
  extentSize(extent).every((size, axis) => size === dimensions[axis]);

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
  const name =
    state.artifactNameByWireId.get(binding.artifactId) ?? wireSegment.name;
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
    candidate.extent.every((value, index) => value === extent[index])
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
