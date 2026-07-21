<template>
  <div class="task-form">
    <!-- The task title lives in the picker above; only the description renders
         here, clamped to two lines until clicked (progressive disclosure). -->
    <div
      v-if="model.description"
      class="text-caption text-medium-emphasis mb-3 task-description"
      :class="{ clamped: !descriptionExpanded }"
      :title="descriptionExpanded ? undefined : 'Show full description'"
      @click="descriptionExpanded = !descriptionExpanded"
    >
      {{ model.description }}
    </div>

    <!-- Fail closed: params the engine could not type are hidden, not rendered.
         A required one blocks submit (surfaced here and in `issues`). -->
    <v-alert
      v-if="model.hidden.length > 0"
      type="info"
      density="compact"
      class="mb-3"
    >
      <div class="text-caption mb-1">
        Some parameters are not supported by this client and were hidden:
      </div>
      <div v-for="h in model.hidden" :key="h.id" class="text-caption">
        • {{ h.id }} ({{ h.reason }})
        <span v-if="h.required">
          — required, so this task cannot be submitted</span
        >
      </div>
    </v-alert>

    <div v-for="section in sections" :key="section.label" class="mb-4">
      <div v-if="showSectionLabel(section.label)" class="text-subtitle-2 mb-2">
        {{ section.label }}
      </div>
      <div v-for="field in section.fields" :key="field.id" class="mb-3">
        <component
          :is="widgetFor(field.kind)"
          :param="field"
          :model-value="values[field.id] as never"
          :binding="
            field.kind === 'sourceRef' ? sourceRefStates?.[field.id] : undefined
          "
          :bound-name="
            field.kind === 'sourceRef' ? sourceRefNames?.[field.id] : undefined
          "
          @update:model-value="(v: ProcessingValue) => update(field.id, v)"
        />
      </div>
    </div>

    <v-alert
      v-if="issues.length > 0"
      type="warning"
      density="compact"
      class="mb-3"
    >
      <div v-for="issue in issues" :key="issue.parameter" class="text-caption">
        {{ issue.message }}
      </div>
    </v-alert>

    <v-btn
      color="primary"
      :disabled="issues.length > 0 || submitting"
      :loading="submitting"
      @click="onSubmit"
    >
      Submit
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';

import type { ProcessingValue } from '@/src/processing/types';
import type {
  FormField,
  TaskFormModel,
  FormValidationIssue,
} from '@/src/processing/engine/formModel';
import type { SourceRefBindingState } from '@/src/processing/engine/mintInput';

import BooleanWidget from './widgets/BooleanWidget.vue';
import NumberWidget from './widgets/NumberWidget.vue';
import StringWidget from './widgets/StringWidget.vue';
import EnumerationWidget from './widgets/EnumerationWidget.vue';
import FileWidget from './widgets/FileWidget.vue';
import BoundsWidget from './widgets/BoundsWidget.vue';

const props = defineProps<{
  model: TaskFormModel;
  initialValues: Record<string, ProcessingValue>;
  issues: FormValidationIssue[];
  // Per-`sourceRef`-param bind state (input mint); read by FileWidget.
  sourceRefStates?: Record<string, SourceRefBindingState>;
  // Per-`sourceRef`-param bound display name (dataset / segment-group name).
  sourceRefNames?: Record<string, string>;
  submitting?: boolean;
}>();
const emit = defineEmits<{
  (e: 'update:values', v: Record<string, ProcessingValue>): void;
  (e: 'submit', v: Record<string, ProcessingValue>): void;
}>();

const descriptionExpanded = ref(false);

// Slicer CLI group labels that carry no meaning for end users.
const HIDDEN_SECTION_LABELS = new Set(['io']);
function showSectionLabel(label: string): boolean {
  return Boolean(label) && !HIDDEN_SECTION_LABELS.has(label.toLowerCase());
}

const values = ref<Record<string, ProcessingValue>>({ ...props.initialValues });
watch(
  () => props.initialValues,
  (v) => {
    values.value = { ...v };
  },
  { deep: true }
);

function update(id: string, v: ProcessingValue) {
  values.value = { ...values.value, [id]: v };
  emit('update:values', values.value);
}

function onSubmit() {
  emit('submit', values.value);
}

// Group renderable fields by their advisory `section` hint, preserving the
// (order-sorted) sequence the model hands us.
const sections = computed(() => {
  const order: string[] = [];
  const bySection = new Map<string, FormField[]>();
  props.model.fields.forEach((f) => {
    const key = f.section ?? '';
    const existing = bySection.get(key);
    if (existing) {
      existing.push(f);
    } else {
      bySection.set(key, [f]);
      order.push(key);
    }
  });
  return order.map((label) => ({ label, fields: bySection.get(label) ?? [] }));
});

function widgetFor(kind: FormField['kind']) {
  switch (kind) {
    case 'bool':
      return BooleanWidget;
    case 'int':
    case 'float':
      return NumberWidget;
    case 'string':
      return StringWidget;
    case 'enum':
      return EnumerationWidget;
    case 'sourceRef':
      return FileWidget;
    case 'bounds':
      return BoundsWidget;
    default:
      return StringWidget;
  }
}
</script>

<style scoped>
.task-form {
  padding: 8px 0;
}
.task-description {
  cursor: pointer;
}
.task-description.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
