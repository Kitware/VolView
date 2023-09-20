<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import type { AnnotationTool } from '../types/annotation-tool';
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

const emit = defineEmits(['done']);
const deleteLabel = () => {
  props.labelsStore.deleteLabel(props.label);
  emit('done');
};
</script>

<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Edit Label
    </v-card-title>

    <v-card-item>
      <div class="d-flex flex-row">
        <div class="flex-grow-1 d-flex flex-column justify-space-between mr-4">
          <div>
            <v-text-field
              v-model="labelName"
              @keydown.stop.enter="$emit('done')"
              label="Name"
              class="flex-grow-0"
            />
          </div>
          <v-card-actions class="mb-2 px-0">
            <v-btn color="secondary" variant="elevated" @click="$emit('done')">
              Done
            </v-btn>
            <v-spacer />
            <v-btn color="red" variant="tonal" @click="deleteLabel">
              Delete label
            </v-btn>
          </v-card-actions>
        </div>
        <v-color-picker v-model="colorLocal" mode="rgb" label="Color" />
      </div>
    </v-card-item>
  </v-card>
</template>
