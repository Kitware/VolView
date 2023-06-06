<script setup lang="ts">
import { useRectangleStore } from '@src/store/tools/rectangles';
import LabelMenu from '@src/components/LabelMenu.vue';

const activeToolStore = useRectangleStore();
</script>

<template>
  <label-menu
    :labels="activeToolStore.labels"
    :set-active-label="activeToolStore.setActiveLabel"
    :active-label="activeToolStore.activeLabel"
  />
</template>
