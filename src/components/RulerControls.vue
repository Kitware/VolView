<script setup lang="ts">
import { useRulerStore } from '@src/store/tools/rulers';
import LabelMenu from '@src/components/LabelMenu.vue';

const { labels, setActiveLabel, activeLabel } = useRulerStore();
</script>

<template>
  <label-menu
    :labels="labels"
    :set-active-label="setActiveLabel"
    :active-label="activeLabel"
  />
</template>
