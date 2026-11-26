<script setup lang="ts">
import { computed } from 'vue';
import { useViewStore } from '@/src/store/views';
import { useViewMove } from '@/src/composables/useViewMove';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

const props = defineProps<{ viewId: string }>();
const viewStore = useViewStore();
const viewMove = useViewMove();

const reason = computed(() => {
  if (viewStore.maximizedView) return 'Restore the view to move it';
  if (viewStore.layoutViews.length <= 1) return 'This is the only open view';
  return '';
});

const moving = computed(() => viewMove?.movingViewId.value === props.viewId);

function start(event: PointerEvent) {
  if (!reason.value) viewMove?.start(props.viewId, event);
}
</script>

<template>
  <ReasonedAction
    :reason="reason"
    :tooltip="moving ? undefined : 'Drag onto another view to move it'"
    v-slot="{ disabled }"
  >
    <v-btn
      icon
      size="x-small"
      variant="text"
      class="pointer-events-all move-handle"
      :class="{ 'move-handle--moving': moving }"
      aria-label="Move view"
      :disabled="disabled"
      @pointerdown.stop="start"
      @click.stop
      @dblclick.stop
    >
      <v-icon size="small" icon="mdi-drag" />
    </v-btn>
  </ReasonedAction>
</template>

<style scoped>
.move-handle {
  cursor: grab;
  touch-action: none;
}
.move-handle--moving {
  cursor: grabbing;
}
</style>
