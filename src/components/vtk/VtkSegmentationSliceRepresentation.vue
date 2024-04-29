<script setup lang="ts">
import { toRefs, watchEffect, inject, computed } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceRepresentation } from '@/src/core/vtk/useSliceRepresentation';
import { LPSAxis } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { SlicingMode } from '@kitware/vtk.js/Rendering/Core/ImageMapper/Constants';
import { VtkViewContext } from '@/src/components/vtk/context';
import {
  useSegmentGroupStore,
  SegmentGroupMetadata,
} from '@/src/store/segmentGroups';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/ImageProperty/Constants';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { syncRef } from '@vueuse/core';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { storeToRefs } from 'pinia';

interface Props {
  viewId: string;
  segmentationId: string;
  axis: LPSAxis;
}

const props = defineProps<Props>();
const { viewId, segmentationId, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const segmentationStore = useSegmentGroupStore();
const metadata = computed<SegmentGroupMetadata | undefined>(
  () => segmentationStore.metadataByID[segmentationId.value]
);
const imageData = computed(
  () => segmentationStore.dataIndex[segmentationId.value]
);

// redraw whenever the image changes
onVTKEvent(imageData, 'onModified', () => {
  view.requestRender();
});

// setup slice rep
const sliceRep = useSliceRepresentation(view, imageData);

sliceRep.property.setRGBTransferFunction(
  0,
  vtkColorTransferFunction.newInstance()
);
sliceRep.property.setScalarOpacity(0, vtkPiecewiseFunction.newInstance());
sliceRep.property.setInterpolationType(InterpolationType.NEAREST);
// needed for vtk.js >= 23.0.0
sliceRep.property.setUseLookupTableScalarRange(true);

// set slice ordering to be in front of the base image
sliceRep.mapper.setResolveCoincidentTopologyToPolygonOffset();
sliceRep.mapper.setResolveCoincidentTopologyPolygonOffsetParameters(-2, -2);

// set opacity from painting tool
const { labelmapOpacity: sliceOpacity } = storeToRefs(usePaintToolStore());
watchEffect(() => {
  sliceRep.property.setOpacity(sliceOpacity.value);
});

// set slicing mode
const parentImageId = computed(() => metadata.value?.parentImage);
const { metadata: parentMetadata } = useImage(parentImageId);

watchEffect(() => {
  const { lpsOrientation } = parentMetadata.value;
  const ijkIndex = lpsOrientation[axis.value];
  const mode = [SlicingMode.I, SlicingMode.J, SlicingMode.K][ijkIndex];
  sliceRep.mapper.setSlicingMode(mode);
});

// sync slicing
const slice = vtkFieldRef(sliceRep.mapper, 'slice');
const { slice: storedSlice } = useSliceConfig(viewId, parentImageId);
syncRef(storedSlice, slice, { immediate: true });

// set coloring properties
const applySegmentColoring = () => {
  const cfun = sliceRep.property.getRGBTransferFunction(0);
  const ofun = sliceRep.property.getPiecewiseFunction(0);

  cfun.removeAllPoints();
  ofun.removeAllPoints();

  let maxValue = 0;

  if (!metadata.value) return; // segment group just deleted

  const { segments } = metadata.value;
  segments.order.forEach((segId) => {
    const segment = segments.byValue[segId];
    const r = segment.color[0] || 0;
    const g = segment.color[1] || 0;
    const b = segment.color[2] || 0;
    const a = segment.color[3] || 0;
    cfun.addRGBPoint(segment.value, r / 255, g / 255, b / 255);
    ofun.addPoint(segment.value, a / 255);

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

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
