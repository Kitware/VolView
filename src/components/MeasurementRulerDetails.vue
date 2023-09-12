<script setup lang="ts">
import { useRulerStore } from '@/src/store/tools/rulers';
import { AnnotationTool } from '../types/annotation-tool';

defineProps<{
  tool: AnnotationTool<string> & { axis: string };
}>();

const toolStore = useRulerStore();
</script>

<template>
  <v-row>
    <v-col cols="4">Slice: {{ tool.slice + 1 }}</v-col>
    <v-col cols="4">Axis: {{ tool.axis }}</v-col>
    <v-col>
      Length:
      <span class="value">
        {{ toolStore.lengthByID[tool.id].toFixed(2) }}mm
      </span>
    </v-col>
  </v-row>
</template>
