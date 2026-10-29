<script setup lang="ts">
import { toRefs, inject, computed, ref, shallowRef } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useLabelmapRepresentation } from '@/src/segmentation/rendering/useLabelmapRepresentation';
import { LPSAxis } from '@/src/types/lps';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSegmentationStore } from '@/src/segmentation/store';
import { watchImmediate } from '@vueuse/core';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import {
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

const appearance = computed(() => {
  const segment = descriptor.value;
  if (!segment) return null;

  const normalAlpha = segmentFillAlpha(segment, display.value.fillOpacity);
  const pulseAlpha = segment.visible ? 0.7 * revealPulse.value : 0;
  const { thicknesses, opacities } = segmentOutline(
    segment,
    display.value.outlineThickness + 3 * revealPulse.value,
    Math.max(display.value.outlineOpacity, revealPulse.value)
  );
  return {
    value: segment.value,
    color: segment.color,
    fillOpacity: Math.max(normalAlpha, pulseAlpha),
    outlineThickness: thicknesses[0],
    outlineOpacity: opacities[0],
  };
});
const sliceRep = useLabelmapRepresentation(view, imageData, appearance, {
  axis: ijkAxis,
});

defineExpose(sliceRep);
</script>

<template>
  <slot></slot>
</template>
