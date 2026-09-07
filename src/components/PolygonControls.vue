<script setup lang="ts">
import { usePolygonStore } from '@/src/store/tools/polygons';
import SegmentPicker from '@/src/components/SegmentPicker.vue';

const activeToolStore = usePolygonStore();
</script>

<template>
  <segment-picker :registry="activeToolStore.segments" />
</template>
