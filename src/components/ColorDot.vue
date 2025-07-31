<script setup lang="ts">
import { rgbaToHexa } from '@/src/utils/color';
import type { RGBAColor } from '@kitware/vtk.js/types';

defineProps<{ color: RGBAColor }>();
</script>

<template>
  <div
    class="color-dot"
    :style="{ background: rgbaToHexa([...color.slice(0,3), 255] as RGBAColor) }"
  />
</template>

<style scoped>
.color-dot {
  width: 18px;
  height: 18px;
  border-radius: 16px;
  border: 1px solid #111;
}
</style>
