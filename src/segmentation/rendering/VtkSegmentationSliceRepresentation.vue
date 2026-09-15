<script setup lang="ts">
import { toRefs, watchEffect, inject, computed, ref } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { LPSAxis } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSegmentationStore } from '@/src/segmentation/store';
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
} from '@/src/segmentation/rendering/display';
import { isEmptyExtent } from '@/src/segmentation/geometry';
import { segmentRenderMask } from '@/src/segmentation/rendering/renderMask';
import { revealPulseStrength } from '@/src/segmentation/composables/useSegmentRevealPulse';

type Props = {
  viewId: string;
  maskId: string;
  // Position in `segmentation.order`, which is what the actors stack by.
  stackIndex: number;
  axis: LPSAxis;
};

const props = defineProps<Props>();
const { viewId, maskId, stackIndex, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const segmentationStore = useSegmentationStore();
// Where the mask sits in the parent image, and what it covers.
const binding = computed(() => segmentationStore.findMaskBinding(maskId.value));
const segmentation = computed(() =>
  segmentationStore.segmentationOfMask(maskId.value)
);
const extent = computed(() => binding.value?.extent);
const descriptor = computed(
  () => segmentationStore.labelmapDescriptorByMask[maskId.value]
);
const segments = computed(() =>
  descriptor.value ? [descriptor.value] : undefined
);
const revealPulse = revealPulseStrength(maskId);

const sourceImageData = computed(() => {
  // A mask that covers nothing has no voxels, so there is no mapper input.
  const bounds = extent.value;
  if (!bounds || isEmptyExtent(bounds)) return null;
  // The id can outlive its segment by a tick, so the accessor is asked rather
  // than indexed.
  const voxels = segmentationStore.findMaskVoxels(maskId.value);
  return voxels.exists() ? voxels.image() : null;
});

const parentImageId = computed(() => segmentation.value?.parentImageId);
const { metadata: parentMetadata, imageData: parentImageData } =
  useImage(parentImageId);
const { slice: storedSlice } = useSliceConfig(viewId, parentImageId);
const maskRevision = ref(0);
onVTKEvent(sourceImageData, 'onModified', () => {
  maskRevision.value += 1;
});
const imageData = computed(() => {
  // VTK modifications are not Vue reactive (painting can keep the same image).
  void maskRevision.value;
  const source = sourceImageData.value;
  const parent = parentImageData.value;
  const bounds = extent.value;
  const ijkAxis = parentMetadata.value?.lpsOrientation[axis.value];
  return source &&
    parent &&
    bounds &&
    ijkAxis !== undefined &&
    storedSlice.value != null
    ? segmentRenderMask(source, parent, bounds, {
        axis: ijkAxis,
        index: storedSlice.value,
      })
    : null;
});
watchImmediate(
  [
    imageData,
    () => {
      void maskRevision.value;
      return imageData.value?.getMTime();
    },
  ],
  () => view.requestRender()
);

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
// segments behind it in the stack: overlap is representable, so a shared offset
// would z-fight.
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
watchEffect(() => {
  const [factor, units] = segmentCoincidentOffset(stackIndex.value);
  sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(
    factor,
    units
  );
});

// Compute segment group's LPS orientation from its direction matrix
const maskLpsOrientation = computed(() => {
  const mask = imageData.value;
  if (!mask) return null;
  return getLPSDirections(mask.getDirection());
});

// Set slicing mode based on segment group's own orientation
watchEffect(() => {
  const lpsOrientation = maskLpsOrientation.value;
  if (!lpsOrientation) return;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// sync slicing - convert parent slice to segment group slice via world coordinates
const slice = vtkFieldRef(sliceRep.mapper, 'slice');

// The extent is a watch source because growth moves the mask's origin, so the
// same parent slice lands on a different mask slice afterwards.
watchImmediate(
  [storedSlice, maskLpsOrientation, parentMetadata, extent, imageData],
  () => {
    const parentImage = parentMetadata.value;
    const mask = imageData.value;
    if (!parentImage || !mask || storedSlice.value == null) return;

    slice.value = convertSliceIndex(
      storedSlice.value,
      parentImage.lpsOrientation,
      parentImage.indexToWorld,
      mask,
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
    const normalAlpha = segmentFillAlpha(
      segment,
      segmentation.value?.fillOpacity ?? 1
    );
    const pulseAlpha = segment.visible ? 0.7 * revealPulse.value : 0;
    ofun.addPoint(segment.value, Math.max(normalAlpha, pulseAlpha));

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
  () => (segmentation.value?.outlineThickness ?? 2) + 3 * revealPulse.value
);
sliceRep.property.setUseLabelOutline(true);

watchEffect(() => {
  if (!segments.value) return; // segment group just deleted

  const groupOpacity = Math.max(
    segmentation.value?.outlineOpacity ?? 1,
    revealPulse.value
  );
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
