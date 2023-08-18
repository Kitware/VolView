<script lang="ts">
import { defineComponent } from 'vue';
import ToolButton from '@/src/components/ToolButton.vue';
import { useCustomEvents } from '@/src/store/custom-events';

export default defineComponent({
  components: {
    ToolButton,
  },
  // setup() {
  // },
  methods: {
    onClick() {
      const events = useCustomEvents();
      events.triggerResetViews();
    }
  }
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
