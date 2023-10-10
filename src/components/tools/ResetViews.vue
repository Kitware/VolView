<script lang="ts">
import { defineComponent } from 'vue';
import ToolButton from '@/src/components/ToolButton.vue';
import { createEventHook } from '@vueuse/core';

const clickEvent = createEventHook<void>();
export function useResetViewsEvents() {
  return { onClick: clickEvent.on };
}

export default defineComponent({
  components: {
    ToolButton,
  },
  // setup() {
  // },
  methods: {
    onClick() {
      clickEvent.trigger();
    },
  },
});
</script>

<template>
  <tool-button
    size="40"
    icon="mdi-camera-flip-outline"
    name="Reset Views"
    @click="onClick"
  />
</template>
