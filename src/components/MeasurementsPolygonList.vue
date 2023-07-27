<script setup lang="ts">
import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import { usePolygonStore } from '@/src/store/tools/polygons';

const toolStore = usePolygonStore();
</script>

<template>
  <MeasurementsToolList :toolStore="toolStore" icon="mdi-vector-polygon" />
</template>
