<script setup lang="ts">
import { toRefs, watchEffect } from 'vue';
import type { LPSAxisDir } from '@/src/types/lps';
import type { Maybe } from '@/src/types';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { useCrosshairsWidget } from './useCrosshairsWidget';

const props = defineProps<{
  viewId: string;
  viewDirection: LPSAxisDir;
  imageId?: Maybe<string>;
}>();
const { viewId, imageId } = toRefs(props);
const manipulator = useCrosshairsWidget(viewId);
const sliceInfo = useSliceInfo(viewId, imageId);
const { metadata } = useImage(imageId);
watchEffect(() => {
  const slice = sliceInfo.value?.slice;
  if (slice == null) return;
  updatePlaneManipulatorFor2DView(
    manipulator,
    props.viewDirection,
    slice,
    metadata.value
  );
});
</script>

<template><slot /></template>
