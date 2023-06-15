<script setup lang="ts">
import { computed } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import { AnnotationTool } from '../types/annotationTool';

const props = defineProps<{
  label: string;
  labelsStore: LabelsStore<AnnotationTool>;
}>();

const label = computed(() => props.labelsStore.labels[props.label]);
</script>

<template>
  <v-card>
    <v-card-title>Edit Label</v-card-title>

    <v-text-field v-model="label.labelName" label="Name" outlined dense />
    <v-color-picker v-model="label.color" label="Color" outlined dense />

    <v-btn
      variant="text"
      density="compact"
      icon="mdi-close"
      @click="$emit('close')"
    />
  </v-card>
</template>

<style scoped></style>
