<script setup lang="ts">
import { toRefs, watchEffect, inject, computed } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { LPSAxis } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSegmentationStore } from '@/src/store/segmentations';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/ImageProperty/Constants';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { watchImmediate } from '@vueuse/core';
import { convertSliceIndex } from '@/src/utils/imageSpace';
import { getLPSDirections } from '@/src/utils/lps';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import {
  SEGMENT_ACTOR_OPACITY,
  segmentCoincidentOffset,
  segmentFillAlpha,
  segmentOutlineTables,
  sliceWithinExtent,
} from '@/src/components/vtk/segmentDisplay';
import { isEmptyExtent } from '@/src/types/segmentation';

interface Props {
  viewId: string;
  maskId: string;
  // Position in `segmentation.order`, which is what the actors stack by.
  stackIndex: number;
  axis: LPSAxis;
}

const props = defineProps<Props>();
const { viewId, maskId, stackIndex, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const segmentationStore = useSegmentationStore();
// Where the mask sits in the parent image, and what it covers.
const binding = computed(() => segmentationStore.findMaskBinding(maskId.value));
const artifactId = computed(() => binding.value?.artifactId);
const extent = computed(() => binding.value?.extent);
const metadata = computed(() =>
  artifactId.value
    ? segmentationStore.artifactMeta[artifactId.value]
    : undefined
);
const segments = computed(() =>
  artifactId.value
    ? segmentationStore.labelmapSegmentsByArtifact[artifactId.value]
    : undefined
);

const imageData = computed(() => {
  // A mask that covers nothing has no voxels, so there is no mapper input.
  const bounds = extent.value;
  if (!artifactId.value || !bounds || isEmptyExtent(bounds)) return null;
  // The id can outlive its artifact by a tick, so the accessor is asked rather
  // than indexed.
  const voxels = segmentationStore.artifactVoxels(artifactId.value);
  return voxels.exists() ? voxels.image() : null;
});

// redraw whenever the image changes
onVTKEvent(imageData, 'onModified', () => {
  view.requestRender();
});

// setup slice rep
const sliceRep = useSliceRepresentation(view, imageData);

// Let widget fill representations be picked through the segment overlay
sliceRep.actor.setPickable(false);

sliceRep.property.setRGBTransferFunction(
  0,
  vtkColorTransferFunction.newInstance()
);
sliceRep.property.setScalarOpacity(0, vtkPiecewiseFunction.newInstance());
sliceRep.property.setInterpolationType(InterpolationType.NEAREST);
sliceRep.property.setOpacity(SEGMENT_ACTOR_OPACITY);
// needed for vtk.js >= 23.0.0
sliceRep.property.setUseLookupTableScalarRange(true);

// Each segment gets its own offset, in front of the base image and of the
// segments before it in the order: overlap is representable, so a shared offset
// would z-fight.
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
watchEffect(() => {
  const [factor, units] = segmentCoincidentOffset(stackIndex.value);
  sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(
    factor,
    units
  );
});

// set slicing mode
const parentImageId = computed(() => metadata.value?.parentImage);
const { metadata: parentMetadata } = useImage(parentImageId);

// Compute segment group's LPS orientation from its direction matrix
const segmentGroupLpsOrientation = computed(() => {
  const segmentGroup = imageData.value;
  if (!segmentGroup) return null;
  return getLPSDirections(segmentGroup.getDirection());
});

// Set slicing mode based on segment group's own orientation
watchEffect(() => {
  const lpsOrientation = segmentGroupLpsOrientation.value;
  if (!lpsOrientation) return;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// sync slicing - convert parent slice to segment group slice via world coordinates
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
const { slice: storedSlice } = useSliceConfig(viewId, parentImageId);

// The extent is a watch source because growth moves the mask's origin, so the
// same parent slice lands on a different mask slice afterwards.
watchImmediate(
  [storedSlice, segmentGroupLpsOrientation, parentMetadata, extent],
  () => {
    const parentImage = parentMetadata.value;
    const segmentGroup = imageData.value;
    if (!parentImage || !segmentGroup || storedSlice.value == null) return;

    slice.value = convertSliceIndex(
      storedSlice.value,
      parentImage.lpsOrientation,
      parentImage.indexToWorld,
      segmentGroup,
      axis.value
    );
  }
);

// A bounded mask covers only part of the volume, and vtkImageMapper clamps a
// slice outside its input to the nearest one, so an actor left visible off its
// own extent would paint a stale slice over the image.
watchEffect(() => {
  const bounds = extent.value;
  const ijkIndex = parentMetadata.value?.lpsOrientation?.[axis.value];
  const drawsHere =
    !!bounds &&
    ijkIndex !== undefined &&
    storedSlice.value != null &&
    sliceWithinExtent(bounds, ijkIndex, storedSlice.value);
  sliceRep.actor.setVisibility(drawsHere);
});

const segmentation = computed(() =>
  artifactId.value
    ? segmentationStore.getSegmentationForArtifact(artifactId.value)
    : undefined
);

// set coloring properties
const applySegmentColoring = () => {
  const cfun = sliceRep.property.getRGBTransferFunction(0);
  const ofun = sliceRep.property.getPiecewiseFunction(0);

  if (!cfun || !ofun) throw new Error('Missing transfer functions');

  cfun.removeAllPoints();
  ofun.removeAllPoints();

  let maxValue = 0;

  if (!segments.value) return; // segment group just deleted

  segments.value.forEach((segment) => {
    const r = segment.color[0] || 0;
    const g = segment.color[1] || 0;
    const b = segment.color[2] || 0;
    cfun.addRGBPoint(segment.value, r / 255, g / 255, b / 255);
    ofun.addPoint(
      segment.value,
      segmentFillAlpha(segment, segmentation.value?.fillOpacity ?? 1)
    );

    maxValue = Math.max(maxValue, segment.value);
  });

  // add min/max values of the colormap range
  cfun.addRGBPoint(0, 0, 0, 0);
  ofun.addPoint(0, 0);
  cfun.addRGBPoint(maxValue + 1, 0, 0, 0);
  ofun.addPoint(maxValue + 1, 0);

  sliceRep.property.modified();
};

watchEffect(applySegmentColoring);

const outlineThickness = computed(
  () => segmentation.value?.outlineThickness ?? 2
);
sliceRep.property.setUseLabelOutline(true);

watchEffect(() => {
  if (!segments.value) return; // segment group just deleted

  const groupOpacity = segmentation.value?.outlineOpacity ?? 1;
  const { thicknesses, opacities } = segmentOutlineTables(
    segments.value,
    outlineThickness.value,
    groupOpacity
  );
  sliceRep.property.setLabelOutlineThickness(thicknesses);
  // An empty table leaves every label without an opacity; fall back to a scalar.
  sliceRep.property.setLabelOutlineOpacity(
    opacities.length ? opacities : groupOpacity
  );
});

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
