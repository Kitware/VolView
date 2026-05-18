<script setup lang="ts">
import { AnnotationTool } from '../types/annotation-tool';

defineProps<{
  tool: AnnotationTool & { axis: string };
}>();
</script>

<template>
  <v-row>
    <v-col v-if="tool.frame != null" cols="4">
      Frame: {{ tool.frame + 1 }}
    </v-col>
    <v-col v-else cols="4">Slice: {{ tool.slice + 1 }}</v-col>
    <v-col cols="4">Axis: {{ tool.axis }}</v-col>
  </v-row>
</template>
