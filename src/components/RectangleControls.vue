<script setup lang="ts">
import { useRectangleStore } from '@/src/store/tools/rectangles';
import SegmentPicker from '@/src/components/SegmentPicker.vue';

const activeToolStore = useRectangleStore();
</script>

<template>
  <segment-picker :registry="activeToolStore.segments" />
</template>
