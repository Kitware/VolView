<script setup lang="ts">
import {
  toRefs,
  watchEffect,
  inject,
  computed,
  ref,
  shallowRef,
  onScopeDispose,
} from 'vue';
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
import { watchImmediate } from '@vueuse/core';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import {
  SEGMENT_ACTOR_OPACITY,
  SEGMENT_COINCIDENT_OFFSET,
  segmentFillAlpha,
  segmentOutline,
} from '@/src/segmentation/rendering/display';
import {
  segmentRenderMask,
  type RenderMaskSlot,
} from '@/src/segmentation/rendering/renderMask';
import { DEFAULT_SEGMENTATION_DISPLAY } from '@/src/segmentation/model';
import { revealPulseStrength } from '@/src/segmentation/rendering/revealPulse';
import type vtkLabelMap from '@/src/vtk/LabelMap';

type Props = {
  viewId: string;
  maskId: string;
  axis: LPSAxis;
};

const props = defineProps<Props>();
const { viewId, maskId, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const segmentationStore = useSegmentationStore();
const segmentation = computed(() =>
  segmentationStore.segmentationOfMask(maskId.value)
);
const binding = computed(
  () => segmentation.value?.masks[maskId.value]?.representations.labelmap
);
const display = computed(
  () => segmentation.value ?? DEFAULT_SEGMENTATION_DISPLAY
);
const extent = computed(() => binding.value?.extent);
const descriptor = computed(
  () => segmentationStore.labelmapDescriptorByMask[maskId.value]
);
const revealPulse = revealPulseStrength(maskId);

const sourceImageData = computed(() => binding.value?.image ?? null);

const parentImageId = computed(() => segmentation.value?.parentImageId);
const { metadata: parentMetadata, imageData: parentImageData } =
  useImage(parentImageId);
const ijkAxis = computed(
  () => parentMetadata.value?.lpsOrientation[axis.value]
);
const { slice: storedSlice } = useSliceConfig(viewId, parentImageId);
const maskRevision = ref(0);
onVTKEvent(sourceImageData, 'onModified', () => {
  maskRevision.value += 1;
});
const renderSlot: RenderMaskSlot = {};
// Filling allocates and mutates vtk images, so it runs in a watcher.
const imageData = shallowRef<vtkLabelMap | null>(null);
watchImmediate(
  [
    () => !!descriptor.value?.visible,
    sourceImageData,
    parentImageData,
    extent,
    ijkAxis,
    storedSlice,
    // VTK modifications are not Vue reactive (painting can keep the same image).
    maskRevision,
  ],
  ([visible, source, parent, bounds, axisIndex, slice]) => {
    // A hidden segment builds no slice and leaves the scene with its null input.
    imageData.value =
      visible &&
      source &&
      parent &&
      bounds &&
      axisIndex !== undefined &&
      slice != null
        ? segmentRenderMask(source, parent, bounds, {
            axis: axisIndex,
            index: slice,
            slot: renderSlot,
          })
        : null;
    view.requestRender();
  }
);

// setup slice rep
const sliceRep = useSliceRepresentation(view, imageData);

// Let widget fill representations be picked through the segment overlay
sliceRep.actor.setPickable(false);

const ownedColorTransferFunction = vtkColorTransferFunction.newInstance();
const ownedOpacityFunction = vtkPiecewiseFunction.newInstance();
sliceRep.property.setRGBTransferFunction(0, ownedColorTransferFunction);
sliceRep.property.setScalarOpacity(0, ownedOpacityFunction);
onScopeDispose(() => {
  ownedColorTransferFunction.delete();
  ownedOpacityFunction.delete();
});
sliceRep.property.setInterpolationType(InterpolationType.NEAREST);
sliceRep.property.setOpacity(SEGMENT_ACTOR_OPACITY);
// needed for vtk.js >= 23.0.0
sliceRep.property.setUseLookupTableScalarRange(true);

// Segments are coplanar with the base image, so they draw at an offset that
// lifts them off it. The offset is the same for every segment.
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(
  ...SEGMENT_COINCIDENT_OFFSET
);

watchEffect(() => {
  if (ijkAxis.value === undefined) return;
  sliceRep.mapper.setSlicingMode(
    [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkAxis.value]
  );
});
// The render mask holds only the viewed plane.
sliceRep.mapper.setSlice(0);

// set coloring properties
const applySegmentColoring = () => {
  const cfun = sliceRep.property.getRGBTransferFunction(0);
  const ofun = sliceRep.property.getPiecewiseFunction(0);

  if (!cfun || !ofun) throw new Error('Missing transfer functions');

  cfun.removeAllPoints();
  ofun.removeAllPoints();

  const segment = descriptor.value;
  if (!segment) return; // segmentation just deleted

  const [r, g, b] = segment.color;
  cfun.addRGBPoint(0, 0, 0, 0);
  ofun.addPoint(0, 0);
  cfun.addRGBPoint(segment.value, r / 255, g / 255, b / 255);
  const normalAlpha = segmentFillAlpha(segment, display.value.fillOpacity);
  const pulseAlpha = segment.visible ? 0.7 * revealPulse.value : 0;
  ofun.addPoint(segment.value, Math.max(normalAlpha, pulseAlpha));
  cfun.addRGBPoint(segment.value + 1, 0, 0, 0);
  ofun.addPoint(segment.value + 1, 0);

  sliceRep.property.modified();
};

watchEffect(applySegmentColoring);

const outlineThickness = computed(
  () => display.value.outlineThickness + 3 * revealPulse.value
);
sliceRep.property.setUseLabelOutline(true);

watchEffect(() => {
  const segment = descriptor.value;
  if (!segment) return; // segmentation just deleted

  const { thicknesses, opacities } = segmentOutline(
    segment,
    outlineThickness.value,
    Math.max(display.value.outlineOpacity, revealPulse.value)
  );
  sliceRep.property.setLabelOutlineThickness(thicknesses);
  sliceRep.property.setLabelOutlineOpacity(opacities);
});

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
