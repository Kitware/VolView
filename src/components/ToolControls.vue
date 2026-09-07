<script setup lang="ts">
import PaintControls from '@/src/components/PaintControls.vue';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';

const toolStore = useToolStore();
</script>

<template>
  <!-- Paint is the only tool with controls of its own, and it brings its own
       panels: rectangle, polygon and ruler draw with the entry selected in the
       lists above. -->
  <paint-controls v-if="toolStore.currentTool === Tools.Paint" />
</template>
