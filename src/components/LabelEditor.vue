<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import { AnnotationTool } from '../types/annotationTool';
import { standardizeColor } from '../utils';

const props = defineProps<{
  label: string;
  labelsStore: LabelsStore<AnnotationTool>;
}>();

const label = computed(() => props.labelsStore.labels[props.label]);

const labelName = ref(label.value.labelName);
watch(labelName, (name) => {
  props.labelsStore.updateLabel(props.label, { labelName: name });
});

const colorLocal = ref(standardizeColor(label.value.color));
watch(colorLocal, (color) => {
  props.labelsStore.updateLabel(props.label, { color });
});

const emit = defineEmits(['close']);
const deleteLabel = () => {
  emit('close');
  props.labelsStore.deleteLabel(props.label);
};
</script>

<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Edit Label
      <v-spacer />
      <v-btn
        variant="text"
        density="compact"
        icon="mdi-close"
        @click="$emit('close')"
      />
    </v-card-title>

    <div class="d-flex flex-row">
      <div class="flex-grow-1 d-flex flex-column">
        <v-text-field
          v-model="labelName"
          @keydown.stop
          label="Name"
          class="flex-grow-0"
        />
        <v-btn
          prepend-icon="mdi-delete"
          @click="deleteLabel"
          class="delete-button"
        >
          Delete Label
        </v-btn>
      </div>
      <v-color-picker v-model="colorLocal" label="Color" />
    </div>
  </v-card>
</template>

<style scoped>
.delete-button {
  max-width: 200px;
  align-self: center;
}
</style>
