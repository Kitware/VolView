<script setup lang="ts">
import { getEnFaceUnavailableReason } from '@/src/enface/availability';
import ViewLayoutActions from '@/src/components/ViewLayoutActions.vue';
import ViewMoveHandle from '@/src/components/ViewMoveHandle.vue';
import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { computed, toRefs, useTemplateRef } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useNarrowPane } from '@/src/composables/useNarrowPane';

// The narrowest pane, in pixels, that fits the select, View actions and move
// handle on one row.
const FULL_ROW_PANE_WIDTH = 176;

const props = withDefaults(
  defineProps<{
    viewId: string;
    imageId: Maybe<string>;
    /** Pixels other controls take on the same row. */
    besideWidth?: number;
  }>(),
  { besideWidth: 0 }
);
const { viewId, imageId } = toRefs(props);

const viewStore = useViewStore();
const controls = useTemplateRef<HTMLElement>('controls');
// A narrow pane moves the type choice into the View actions menu.
const compact = useNarrowPane(
  controls,
  () => FULL_ROW_PANE_WIDTH + props.besideWidth
);

const viewName = computed(() => {
  return viewStore.getView(viewId.value)?.name ?? '';
});

const enFaceReason = computed(() => getEnFaceUnavailableReason(imageId.value));

const availableViewNames = computed(() =>
  viewStore.availableViewsForSwitcher.map((view) => {
    const reason = view.type === 'EnFace' ? enFaceReason.value : null;
    return {
      title: view.name,
      value: view.name,
      reason,
      props: { disabled: !!reason },
    };
  })
);

function updateView(newViewName: string) {
  if (newViewName === viewName.value) return;
  const selectedView = viewStore.availableViewsForSwitcher.find(
    (v) => v.name === newViewName
  );
  if (!selectedView) return;
  if (selectedView.type === 'EnFace' && enFaceReason.value) return;
  viewStore.replaceView(viewId.value, {
    ...selectedView,
    dataID: imageId.value,
  });
}
</script>

<template>
  <div ref="controls" class="view-controls pointer-events-all" @dblclick.stop>
    <v-select
      v-if="!compact"
      :model-value="viewName"
      @update:model-value="updateView($event)"
      :items="availableViewNames"
      density="compact"
      hide-details
      variant="solo"
      class="pointer-events-all view-type-select"
      aria-label="View type"
    >
      <template #item="{ props: itemProps, item }">
        <ReasonedAction :reason="item.raw.reason ?? undefined" block>
          <v-list-item v-bind="itemProps" />
        </ReasonedAction>
      </template>
    </v-select>
    <ViewLayoutActions :view-id="viewId">
      <template v-if="compact" #default>
        <v-list-subheader>View type</v-list-subheader>
        <ReasonedAction
          v-for="item in availableViewNames"
          :key="item.value"
          :reason="item.reason ?? undefined"
          block
          v-slot="{ disabled }"
        >
          <v-list-item
            :title="item.title"
            :active="item.value === viewName"
            :disabled="disabled"
            @click="updateView(item.value)"
          />
        </ReasonedAction>
      </template>
    </ViewLayoutActions>
    <ViewMoveHandle :view-id="viewId" />
  </div>
</template>

<style scoped>
.view-controls {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.view-type-select {
  width: 90px;
  flex: 0 0 90px;
  max-width: 90px;
  font-size: 0.8125rem;
  margin-left: auto;
  color: rgb(var(--v-theme-on-surface));
  text-shadow: none;
  letter-spacing: normal;
}

.view-type-select :deep(.v-field__input) {
  padding: 0 4px;
  min-height: 20px;
  text-align: right;
  font-size: 0.8125rem;
}

.view-type-select :deep(.v-field) {
  min-height: 20px;
}

.view-type-select :deep(.v-field__append-inner) {
  padding-top: 0;
  padding-right: 2px;
}

.view-type-select :deep(.v-input__control) {
  min-height: 20px;
}

.view-type-select :deep(.v-field__overlay) {
  background-color: transparent;
}

.view-type-select :deep(.v-icon) {
  font-size: 0.875rem;
}
</style>
