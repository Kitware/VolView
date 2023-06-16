<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import { AnnotationTool } from '../types/annotationTool';

const props = defineProps<{
  label: string;
  labelsStore: LabelsStore<AnnotationTool>;
}>();

const label = computed(() => props.labelsStore.labels[props.label]);

const labelName = ref(label.value.labelName);
watch(labelName, (name) => {
  props.labelsStore.updateLabel(props.label, { labelName: name });
});

const colorLocal = ref(label.value.color);
watch(colorLocal, (color) => {
  props.labelsStore.updateLabel(props.label, { color });
});
</script>

<template>
  <v-card>
    <v-card-title>Edit Label</v-card-title>

    <v-text-field v-model="labelName" label="Name" outlined dense />
    <v-color-picker v-model="colorLocal" label="Color" outlined dense />

    <v-btn
      variant="text"
      density="compact"
      icon="mdi-close"
      @click="$emit('close')"
    />
  </v-card>
</template>

<style scoped></style>
