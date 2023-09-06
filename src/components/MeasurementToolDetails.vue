<script setup lang="ts">
import { AnnotationTool } from '../types/annotation-tool';

defineProps<{
  tool: AnnotationTool<string> & { axis: string };
}>();
</script>

<template>
  <v-row>
    <v-col cols="3">Slice: {{ tool.slice + 1 }}</v-col>
    <v-col cols="3">Axis: {{ tool.axis }}</v-col>
  </v-row>
</template>
