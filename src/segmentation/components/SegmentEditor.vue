<script setup lang="ts">
import { computed } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

const emit = defineEmits<{
  done: [];
  cancel: [];
  delete: [];
  'update:name': [name: string];
  'update:color': [color: string];
  'update:fillOpacity': [opacity: number];
  'update:outlineOpacity': [opacity: number];
  'update:strokeWidth': [width: number];
}>();

const props = defineProps<{
  name: string;
  original: string;
  color: string;
  invalidNames: Set<string>;
  fillOpacity: number;
  outlineOpacity: number;
  strokeWidth: number;
  locked: boolean;
}>();

function isUniqueEditingName(name: string) {
  const normalized = name.trim();
  return (
    normalized === props.original.trim() || !props.invalidNames.has(normalized)
  );
}

function uniqueNameRule(name: string) {
  return isUniqueEditingName(name) || 'Name is not unique';
}

const lockedReason = computed(() =>
  props.locked ? 'Unlock this segment to edit or delete it' : ''
);
const doneReason = computed(
  () =>
    lockedReason.value ||
    (isUniqueEditingName(props.name) ? '' : 'Choose a unique name')
);

const done = () => {
  if (!doneReason.value) emit('done');
};

const onDelete = () => {
  if (!lockedReason.value) emit('delete');
};
</script>

<template>
  <v-card>
    <v-card-item>
      <div class="segment-editor-layout d-flex flex-row">
        <div
          class="segment-editor-fields flex-grow-1 d-flex flex-column justify-space-between mr-4"
        >
          <v-text-field
            label="Name"
            class="flex-grow-0"
            :model-value="name"
            @update:model-value="$emit('update:name', $event)"
            @keydown.stop.enter="done"
            :rules="[uniqueNameRule]"
          />
          <v-slider
            class="mx-4 my-1"
            label="Fill Opacity"
            name="Fill Opacity"
            min="0"
            max="1"
            step="0.01"
            density="compact"
            hide-details
            thumb-label
            :model-value="fillOpacity"
            @update:model-value="$emit('update:fillOpacity', $event)"
          />
          <v-slider
            class="mx-4 my-1"
            label="Outline Opacity"
            name="Outline Opacity"
            min="0"
            max="1"
            step="0.01"
            density="compact"
            hide-details
            thumb-label
            :model-value="outlineOpacity"
            @update:model-value="$emit('update:outlineOpacity', $event)"
          />
          <v-slider
            class="mx-4 my-1"
            label="Stroke Width"
            name="Stroke Width"
            :min="1"
            :max="5"
            :step="1"
            show-ticks="always"
            density="compact"
            hide-details
            thumb-label
            :model-value="strokeWidth"
            @update:model-value="
              $emit('update:strokeWidth', Math.round($event))
            "
          />
          <v-card-actions class="mb-2 px-0">
            <reasoned-action
              :reason="lockedReason"
              tooltip="Delete from every image"
              v-slot="{ disabled }"
            >
              <v-btn
                color="error"
                variant="elevated"
                aria-label="Delete this segment from every image"
                @click="onDelete"
                :disabled="disabled"
              >
                Delete
              </v-btn>
            </reasoned-action>
            <v-spacer />
            <v-btn color="cancel" variant="tonal" @click="$emit('cancel')">
              Cancel
            </v-btn>
            <reasoned-action :reason="doneReason" v-slot="{ disabled }">
              <v-btn
                color="secondary"
                variant="elevated"
                @click="done"
                :disabled="disabled"
                data-testid="segment-editor-done-button"
              >
                Done
              </v-btn>
            </reasoned-action>
          </v-card-actions>
        </div>
        <v-color-picker
          class="segment-editor-color-picker"
          :model-value="color"
          @update:model-value="$emit('update:color', $event)"
          mode="rgb"
          label="Color"
        />
      </div>
    </v-card-item>
  </v-card>
</template>

<style scoped>
@media (max-width: 600px) {
  .segment-editor-layout {
    flex-direction: column !important;
  }

  .segment-editor-fields {
    margin-right: 0 !important;
  }

  .segment-editor-color-picker {
    width: 100%;
    max-width: 100%;
  }
}
</style>
