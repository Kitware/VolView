<template>
  <div class="task-form">
    <div
      v-if="model.description"
      class="text-caption text-medium-emphasis mb-3 task-description"
      :class="{ clamped: !descriptionExpanded }"
      :title="descriptionExpanded ? undefined : 'Show full description'"
      @click="descriptionExpanded = !descriptionExpanded"
    >
      {{ model.description }}
    </div>

    <template v-if="parameterFields.length > 0">
      <div v-for="field in parameterFields" :key="field.id" class="mb-3">
        <div class="field-label">{{ fieldLabel(field) }}</div>
        <component
          :is="widgetFor(field.kind)"
          :param="field"
          :model-value="values[field.id] as never"
          @update:model-value="(v: ProcessingValue) => update(field.id, v)"
          @update:error="(err: string | null) => setWidgetError(field.id, err)"
        />
      </div>
    </template>

    <template v-if="inputFields.length > 0">
      <div v-for="field in inputFields" :key="field.id" class="mb-3">
        <FileWidget
          :param="field"
          :model-value="values[field.id] as never"
          :binding="sourceRefStates?.[field.id]"
          :bound-name="sourceRefNames?.[field.id]"
          @update:model-value="(v: ProcessingValue) => update(field.id, v)"
        />
      </div>
    </template>

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

    <!-- Low-emphasis on purpose: accent blue is reserved for the active tab and links. -->
    <v-btn
      block
      variant="tonal"
      :disabled="issues.length > 0 || hasWidgetErrors || submitting"
      :loading="submitting"
      @click="onSubmit"
    >
      Submit
    </v-btn>

    <div
      v-if="model.hidden.length > 0"
      class="text-caption text-medium-emphasis mt-3"
    >
      <div class="mb-1">
        Some parameters are not supported by this client and are not shown:
      </div>
      <div v-for="h in model.hidden" :key="h.id">
        • {{ h.id }} ({{ h.reason }})
        <span v-if="h.required">
          — required, so this task cannot be submitted</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';

import type { ProcessingValue } from '@/src/processing/types';
import {
  fieldLabel,
  type FormField,
  type TaskFormModel,
  type FormValidationIssue,
} from '@/src/processing/engine/formModel';
import type { SourceRefBindingState } from '@/src/processing/engine/mintInput';

import BooleanWidget from './widgets/BooleanWidget.vue';
import NumberWidget from './widgets/NumberWidget.vue';
import StringWidget from './widgets/StringWidget.vue';
import EnumerationWidget from './widgets/EnumerationWidget.vue';
import FileWidget from './widgets/FileWidget.vue';

// Fully controlled: the parent owns the values; edits round-trip through
// `update:values`.
const props = defineProps<{
  model: TaskFormModel;
  values: Record<string, ProcessingValue>;
  issues: FormValidationIssue[];
  sourceRefStates?: Record<string, SourceRefBindingState>;
  sourceRefNames?: Record<string, string>;
  submitting?: boolean;
}>();
const emit = defineEmits<{
  (e: 'update:values', v: Record<string, ProcessingValue>): void;
  (e: 'submit', v: Record<string, ProcessingValue>): void;
}>();

const descriptionExpanded = ref(false);

function update(id: string, v: ProcessingValue) {
  emit('update:values', { ...props.values, [id]: v });
}

// Widget-local rejections (e.g. "1.9" in an int field) that form-level
// validation cannot see — the widget emitted null, which is valid for an
// optional parameter. They still must block Submit.
const widgetErrors = ref<Record<string, string>>({});
function setWidgetError(id: string, err: string | null) {
  const next = { ...widgetErrors.value };
  if (err == null) delete next[id];
  else next[id] = err;
  widgetErrors.value = next;
}
watch(
  () => props.model,
  () => {
    widgetErrors.value = {};
  }
);
const hasWidgetErrors = computed(
  () => Object.keys(widgetErrors.value).length > 0
);

function onSubmit() {
  emit('submit', props.values);
}

// `bounds` has no widget: the crop-box binding authors its value at submit.
const parameterFields = computed(() =>
  props.model.fields.filter(
    (f) => f.kind !== 'sourceRef' && f.kind !== 'bounds'
  )
);

const inputFields = computed(() =>
  props.model.fields.filter((f) => f.kind === 'sourceRef')
);

function widgetFor(kind: FormField['kind']) {
  switch (kind) {
    case 'bool':
      return BooleanWidget;
    case 'int':
    case 'float':
      return NumberWidget;
    case 'enum':
      return EnumerationWidget;
    case 'string':
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
.field-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-bottom: 6px;
}
</style>
