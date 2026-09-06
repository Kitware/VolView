<script setup lang="ts">
import { usePolygonStore } from '@/src/store/tools/polygons';
import SegmentTypeList from '@/src/components/SegmentTypeList.vue';

const activeToolStore = usePolygonStore();
</script>

<template>
  <segment-type-list :registry="activeToolStore.types" />
</template>
