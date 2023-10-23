<script setup lang="ts">
import { computed } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import type { AnnotationTool } from '../types/annotation-tool';
import { standardizeColor } from '../utils';

const props = defineProps<{
  label: string;
  labelsStore: LabelsStore<AnnotationTool>;
}>();

const label = computed(() => props.labelsStore.labels[props.label]);

type LabelProp = keyof typeof label.value;
const getLabelProp = <P extends LabelProp>(labelProp: P) =>
  label.value[labelProp];

const makeUpdatableLabelProp = <P extends LabelProp>(
  labelProp: P,
  get: (labelProp: P) => (typeof label.value)[P] = getLabelProp
) =>
  computed({
    get: () => get(labelProp),
    set(value) {
      props.labelsStore.updateLabel(props.label, { [labelProp]: value });
    },
  });

const labelName = makeUpdatableLabelProp('labelName');
const strokeWidth = makeUpdatableLabelProp('strokeWidth');
const color = makeUpdatableLabelProp('color', (labelProp) =>
  standardizeColor(getLabelProp(labelProp))
);

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
          <v-text-field
            v-model="labelName"
            @keydown.stop.enter="$emit('done')"
            label="Name"
            class="flex-grow-0"
          />
          <v-text-field
            v-model.number="strokeWidth"
            @keydown.stop.enter="$emit('done')"
            label="Stroke Width"
            type="number"
            class="flex-grow-0"
            id="label-stroke-width-input"
          />
          <v-card-actions class="mb-2 px-0">
            <v-btn
              color="secondary"
              variant="elevated"
              @click="$emit('done')"
              data-testid="edit-label-done-button"
            >
              Done
            </v-btn>
            <v-spacer />
            <v-btn color="red" variant="tonal" @click="deleteLabel">
              Delete label
            </v-btn>
          </v-card-actions>
        </div>
        <v-color-picker v-model="color" mode="rgb" label="Color" />
      </div>
    </v-card-item>
  </v-card>
</template>
