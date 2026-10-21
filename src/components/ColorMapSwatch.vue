<script setup lang="ts">
import { computed } from 'vue';
import { colorMapGradient } from '@/src/utils/colorMapGradient';

const props = defineProps<{
  preset: string;
  domain?: readonly [number, number];
  mappingRange?: readonly [number, number];
  transparentBackground?: boolean;
}>();

const gradient = computed(() =>
  colorMapGradient(
    props.preset,
    props.domain,
    props.mappingRange,
    props.transparentBackground
  )
);
</script>

<template>
  <div class="color-map-swatch" :style="{ backgroundImage: gradient }" />
</template>

<style scoped>
.color-map-swatch {
  height: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.5);
  border-radius: 2px;
  background-color: rgb(var(--v-theme-surface));
}
</style>
