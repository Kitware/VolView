<script setup lang="ts">
/* globals defineOptions */
import { computed, PropType } from 'vue';
import { useDisplay } from 'vuetify';

defineOptions({
  inheritAttrs: false,
});

const props = defineProps({
  modelValue: Boolean,
  width: {
    type: String,
    required: false,
  },
  maxWidth: {
    type: String,
    default: '960px',
  },
  closeOffsetX: {
    type: Number as PropType<string | number>,
    default: () => 8,
  },
  closeOffsetY: {
    type: Number as PropType<string | number>,
    default: () => 8,
  },
});

const $emit = defineEmits(['update:model-value']);

const close = () => {
  $emit('update:model-value', false);
};

const display = useDisplay();

const width = computed(() => {
  if (props.width) {
    return props.width;
  }
  return display.mobile.value ? '100%' : '75%';
});
const maxWidth = computed(() => {
  return display.mobile.value ? '100%' : props.maxWidth;
});
</script>

<template>
  <v-dialog
    v-bind="$attrs"
    :content-class="['closeable-dialog', $attrs['content-class']]"
    :width="width"
    :max-width="maxWidth"
    :model-value="props.modelValue"
    @update:model-value="$emit('update:model-value', $event)"
    @keydown.stop
  >
    <v-btn
      variant="flat"
      class="close-button"
      :style="{
        top: `${props.closeOffsetY}px`,
        right: `${props.closeOffsetX}px`,
      }"
      icon="mdi-close"
      @click="close"
    />
    <slot :close="close" />
  </v-dialog>
</template>

<style scoped>
.close-button {
  position: absolute;
  z-index: 100;
}
</style>

<style>
/* add padding to inner v-cards */
.closeable-dialog > .v-card {
  padding: 8px 0;
}
</style>
