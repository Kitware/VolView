<script setup lang="ts">
import { useRectangleStore } from '@src/store/tools/rectangles';
import LabelControls from '@src/components/LabelControls.vue';

const activeToolStore = useRectangleStore();
</script>

<template>
  <label-controls
    :labels="activeToolStore.labels"
    :set-active-label="activeToolStore.setActiveLabel"
    :active-label="activeToolStore.activeLabel"
  />
</template>
