<script setup lang="ts">
import { toRefs, watchEffect } from 'vue';
import type { Vector3 } from '@kitware/vtk.js/types';
import { useCrosshairsWidget } from './useCrosshairsWidget';

const props = defineProps<{
  viewId: string;
  planeOrigin: Vector3;
  planeNormal: Vector3;
}>();
const { viewId } = toRefs(props);
const manipulator = useCrosshairsWidget(viewId);
watchEffect(() => {
  manipulator.setUserOrigin(props.planeOrigin);
  manipulator.setUserNormal(props.planeNormal);
});
</script>

<template><slot /></template>
