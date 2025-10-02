<script setup lang="ts">
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

const availableViews = getAvailableViews().list;
const availableViewNames = availableViews.map((v) => v.name);

function updateView(newViewName: string) {
  const selectedView = availableViews.find((v) => v.name === newViewName);
  if (!selectedView) return;
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
  ></v-select>
</template>

<style scoped>
.view-type-select {
  max-width: 90px;
  font-size: 0.8125rem;
  margin-left: auto;
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
