<script setup lang="ts">
import { useRulerStore } from '@src/store/tools/rulers';
import LabelControls from '@src/components/LabelControls.vue';

const activeToolStore = useRulerStore();
</script>

<template>
  <label-controls
    :labels="activeToolStore.labels"
    :set-active-label="activeToolStore.setActiveLabel"
    :active-label="activeToolStore.activeLabel"
    :update-label="activeToolStore.updateLabel"
  />
</template>
