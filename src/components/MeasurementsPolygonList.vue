<script setup lang="ts">
import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import { usePolygonStore } from '@/src/store/tools/polygons';

const rectStore = usePolygonStore();
</script>

<template>
  <MeasurementsToolList
    :toolStore="rectStore as any"
    icon="mdi-vector-polygon"
  />
</template>
