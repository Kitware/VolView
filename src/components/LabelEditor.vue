<script setup lang="ts">
import { computed, toRefs } from 'vue';

const emit = defineEmits(['done', 'cancel', 'delete', 'update:color']);
const props = defineProps<{
  color: string;
  valid: boolean;
  disabledReason?: string;
}>();
const { color, valid } = toRefs(props);
const doneDisabled = computed(() => {
  return !valid.value || !!props.disabledReason;
});

const done = () => {
  if (!doneDisabled.value) emit('done');
};

const cancel = () => {
  emit('cancel');
};

const onDelete = () => {
  if (props.disabledReason) return;
  emit('delete');
  emit('done');
};
</script>

<template>
  <v-card>
    <slot name="title"></slot>
    <v-card-item>
      <div class="label-editor-layout d-flex flex-row">
        <div
          class="label-editor-fields flex-grow-1 d-flex flex-column justify-space-between mr-4"
        >
          <slot name="fields" :done="done"></slot>
          <v-card-actions class="mb-2 px-0">
            <span
              class="d-inline-flex"
              :tabindex="disabledReason ? 0 : undefined"
            >
              <v-btn
                color="error"
                variant="elevated"
                @click="onDelete"
                :disabled="!!disabledReason"
              >
                Delete
              </v-btn>
              <v-tooltip
                v-if="disabledReason"
                location="top"
                activator="parent"
                >{{ disabledReason }}</v-tooltip
              >
            </span>
            <v-spacer />
            <v-btn color="cancel" variant="tonal" @click="cancel">
              Cancel
            </v-btn>
            <span
              class="d-inline-flex"
              :tabindex="doneDisabled ? 0 : undefined"
            >
              <v-btn
                color="secondary"
                variant="elevated"
                @click="done"
                :disabled="doneDisabled"
                data-testid="edit-label-done-button"
              >
                Done
              </v-btn>
              <v-tooltip
                v-if="doneDisabled"
                location="top"
                activator="parent"
                >{{ disabledReason || 'Choose a unique name' }}</v-tooltip
              >
            </span>
          </v-card-actions>
        </div>
        <v-color-picker
          class="label-color-picker"
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
  .label-editor-layout {
    flex-direction: column !important;
  }

  .label-editor-fields {
    margin-right: 0 !important;
  }

  .label-color-picker {
    width: 100%;
    max-width: 100%;
  }
}
</style>
