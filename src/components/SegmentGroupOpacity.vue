<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { BlendConfig } from '@/src/types/views';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { useSegmentGroupConfigInitializer } from '@/src/composables/useSegmentGroupConfigInitializer';
import { InitViewSpecs } from '../config';

const props = defineProps<{
  groupId: string;
}>();

const { groupId } = toRefs(props);

const layerColoringStore = useLayerColoringStore();

const VIEWS_2D = Object.entries(InitViewSpecs)
  .filter(([, { viewType }]) => viewType === '2D')
  .map(([viewID]) => viewID);

useSegmentGroupConfigInitializer(VIEWS_2D[0], groupId.value);

const layerConfigs = computed(() =>
  VIEWS_2D.map((viewID) => ({
    config: layerColoringStore.getConfig(viewID, groupId.value),
    viewID,
  }))
);

const blendConfig = computed(
  () => layerConfigs.value.find(({ config }) => config)!.config!.blendConfig
);

const setBlendConfig = (key: keyof BlendConfig, value: any) => {
  layerConfigs.value.forEach(({ viewID }) =>
    layerColoringStore.updateBlendConfig(viewID, groupId.value, {
      [key]: value,
    })
  );
};
</script>

<template>
  <v-slider
    class="py-4"
    label="Segment Group Opacity"
    min="0"
    max="1"
    step="0.01"
    density="compact"
    hide-details
    thumb-label
    :model-value="blendConfig.opacity"
    @update:model-value="setBlendConfig('opacity', $event)"
  />
</template>
