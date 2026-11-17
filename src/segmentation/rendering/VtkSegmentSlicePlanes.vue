<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentSlicePlanes } from '@/src/segmentation/rendering/useSegmentSlicePlanes';
import VtkSegmentSlicePlane from '@/src/segmentation/rendering/VtkSegmentSlicePlane.vue';
import type { LPSAxis } from '@/src/types/lps';
import type { Maybe } from '@/src/types';

const props = defineProps<{
  viewId: string;
  imageId: Maybe<string>;
  axis: LPSAxis;
}>();
const { viewId, imageId, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { planes, ijkAxis } = useSegmentSlicePlanes(viewId, imageId, axis, () =>
  view.requestRender()
);
const registry = useSegmentStore().segments;
const display = computed(() => registry.displayOf(imageId.value));
</script>

<template>
  <vtk-segment-slice-plane
    v-for="(plane, index) in planes"
    :key="index"
    :image="plane.image"
    :segment-ids="plane.segmentIds"
    :display="display"
    :axis="ijkAxis"
  />
</template>
