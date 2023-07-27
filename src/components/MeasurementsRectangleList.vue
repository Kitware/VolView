<script setup lang="ts">
import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import { useRectangleStore } from '../store/tools/rectangles';

const toolStore = useRectangleStore();
</script>

<template>
  <MeasurementsToolList :toolStore="toolStore" icon="mdi-vector-square" />
</template>
