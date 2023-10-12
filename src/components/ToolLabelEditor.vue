<script setup lang="ts">
import { computed } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import LabelEditor from '@/src/components/LabelEditor.vue';
import type { AnnotationTool } from '../types/annotation-tool';
import { standardizeColor } from '../utils';

defineEmits(['done']);

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

const deleteLabel = () => {
  props.labelsStore.deleteLabel(props.label);
};
</script>

<template>
  <label-editor
    v-model:color="color"
    @done="$emit('done')"
    @delete="deleteLabel"
  >
    <template #title>
      <v-card-title class="d-flex flex-row align-center">
        Edit Label
      </v-card-title>
    </template>
    <template #fields="{ done }">
      <v-text-field
        v-model="labelName"
        @keydown.stop.enter="done"
        label="Name"
        class="flex-grow-0"
      />
      <v-text-field
        v-model.number="strokeWidth"
        @keydown.stop.enter="done"
        label="Stroke Width"
        type="number"
        class="flex-grow-0"
      />
    </template>
  </label-editor>
</template>
