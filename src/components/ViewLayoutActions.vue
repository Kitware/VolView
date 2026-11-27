<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue';
import type { LayoutDirection } from '@/src/types/layout';
import { useViewStore } from '@/src/store/views';
import { canSplit } from '@/src/utils/layoutEditing';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

// MDI's split icons read as text beside a box; these are a frame with one divider.
const sideBySideIcon = 'svg:M3 4h18v16H3V4zm2 2v12h6V6H5zm8 0v12h6V6h-6z';
const topBottomIcon = 'svg:M3 4h18v16H3V4zm2 2v5h14V6H5zm0 7v5h14v-5H5z';

const props = defineProps<{ viewId: string }>();
const viewStore = useViewStore();
const control = useTemplateRef<HTMLElement>('control');
const fits = shallowRef({ row: true, column: true });

// Border-box matches the pane bounds the dock and divider limits use.
function measure(open: boolean) {
  const pane = control.value?.closest<HTMLElement>('.layout-item');
  if (open && pane) fits.value = canSplit(pane.getBoundingClientRect());
}

const isMaximized = computed(
  () => viewStore.maximizedView?.id === props.viewId
);

const splitReasons = computed(() => {
  if (viewStore.maximizedView) {
    const restore = 'Restore the view to split it';
    return { row: restore, column: restore };
  }
  return {
    row: fits.value.row ? '' : 'This view is too narrow to split side by side',
    column: fits.value.column
      ? ''
      : 'This view is too short to split top and bottom',
  };
});
const singleViewReason = computed(() =>
  viewStore.layoutViews.length <= 1 ? 'This is the only open view' : ''
);

function split(direction: LayoutDirection) {
  if (!splitReasons.value[direction]) {
    viewStore.splitView(props.viewId, direction);
  }
}

function toggleMaximized() {
  viewStore.setActiveView(props.viewId);
  viewStore.toggleActiveViewMaximized();
}
</script>

<template>
  <span ref="control" class="d-inline-flex">
    <v-menu location="top end" @update:model-value="measure">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          icon
          size="x-small"
          variant="text"
          class="pointer-events-all"
          aria-label="View actions"
          @click.stop
          @dblclick.stop
        >
          <v-icon size="small" :icon="sideBySideIcon" />
          <v-tooltip activator="parent" location="top">View actions</v-tooltip>
        </v-btn>
      </template>
      <v-list density="compact" aria-label="View actions">
        <ReasonedAction :reason="splitReasons.row" block v-slot="{ disabled }">
          <v-list-item
            :prepend-icon="sideBySideIcon"
            title="Split side by side"
            :disabled="disabled"
            @click="split('row')"
          />
        </ReasonedAction>
        <ReasonedAction
          :reason="splitReasons.column"
          block
          v-slot="{ disabled }"
        >
          <v-list-item
            :prepend-icon="topBottomIcon"
            title="Split top and bottom"
            :disabled="disabled"
            @click="split('column')"
          />
        </ReasonedAction>
        <v-divider />
        <ReasonedAction
          :reason="isMaximized ? '' : singleViewReason"
          block
          v-slot="{ disabled }"
        >
          <v-list-item
            :prepend-icon="
              isMaximized ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'
            "
            :title="isMaximized ? 'Restore view' : 'Maximize view'"
            :disabled="disabled"
            @click="toggleMaximized"
          />
        </ReasonedAction>
        <ReasonedAction :reason="singleViewReason" block v-slot="{ disabled }">
          <v-list-item
            prepend-icon="mdi-close"
            title="Close view"
            :disabled="disabled"
            @click="viewStore.closeView(viewId)"
          />
        </ReasonedAction>
      </v-list>
    </v-menu>
  </span>
</template>
