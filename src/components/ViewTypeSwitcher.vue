<script setup lang="ts">
import { getOCTAvailability } from '@/src/oct';
import { getAvailableViews } from '@/src/config';
import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { computed, toRefs } from 'vue';

const props = defineProps<{
  viewId: string;
  imageId: Maybe<string>;
}>();
const { viewId, imageId } = toRefs(props);

const viewStore = useViewStore();

const viewName = computed(() => {
  const viewInfo = viewStore.getView(viewId.value);
  return viewInfo?.name ?? '';
});

const switcherViews = computed(() =>
  getAvailableViews().list.filter(
    (view) =>
      view.type === 'EnFace' || !viewStore.disabledViewTypes.includes(view.type)
  )
);
const enFaceReason = computed(() =>
  viewStore.disabledViewTypes.includes('EnFace')
    ? 'The current configuration disables En face views.'
    : getOCTAvailability(imageId.value).reason
);

const availableViewNames = computed(() =>
  switcherViews.value.map((view) => {
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
  const selectedView = switcherViews.value.find((v) => v.name === newViewName);
  if (!selectedView) return;
  if (selectedView.type === 'EnFace' && enFaceReason.value) return;
  viewStore.replaceView(viewId.value, {
    ...selectedView,
    dataID: imageId.value,
  });
}
</script>

<template>
  <v-select
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
      <v-tooltip :disabled="!item.raw.reason" location="left">
        <template #activator="{ props: tooltipProps }">
          <div v-bind="tooltipProps" :title="item.raw.reason ?? undefined">
            <v-list-item v-bind="itemProps" />
          </div>
        </template>
        {{ item.raw.reason }}
      </v-tooltip>
    </template>
  </v-select>
</template>

<style scoped>
.view-type-select {
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
