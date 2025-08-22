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
  <v-menu location="top right" :close-on-content-click="false" offset="10">
    <template #activator="{ props }">
      <v-btn size="xs" v-bind="props" class="pointer-events-all">
        {{ viewName }}
      </v-btn>
    </template>
    <v-card min-width="150">
      <v-select
        :model-value="viewName"
        @update:model-value="updateView($event)"
        :items="availableViewNames"
        density="compact"
        hide-details
      ></v-select>
    </v-card>
  </v-menu>
</template>
