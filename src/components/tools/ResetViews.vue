<script lang="ts">
import { defineComponent } from 'vue';
import ControlButton from '@/src/components/ControlButton.vue';
import { createEventHook } from '@vueuse/core';

const clickEvent = createEventHook<void>();
export function useResetViewsEvents() {
  return { onClick: clickEvent.on };
}

export default defineComponent({
  components: {
    ControlButton,
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
  <control-button
    size="40"
    icon="mdi-camera-flip-outline"
    name="Reset Views"
    @click="onClick"
  />
</template>
