<script setup lang="ts">
import { useRectangleStore } from '@/src/store/tools/rectangles';
import SegmentTypeList from '@/src/components/SegmentTypeList.vue';

const activeToolStore = useRectangleStore();
</script>

<template>
  <segment-type-list :registry="activeToolStore.types" />
</template>
