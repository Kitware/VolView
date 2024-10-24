<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useGlobalLayerColorConfig } from '@/src/composables/useGlobalLayerColorConfig';
import { useGlobalSegmentGroupConfig } from '@/src/store/view-configs/segmentGroups';

const props = defineProps<{
  groupId: string;
}>();

const { groupId } = toRefs(props);

const { sampledConfig, updateConfig } = useGlobalLayerColorConfig(groupId);

const blendConfig = computed(() => sampledConfig.value!.config!.blendConfig);

const setOpacity = (opacity: number) => {
  updateConfig({
    blendConfig: {
      ...blendConfig.value,
      // 1.0 puts us in Opaque render pass which changes stack order.
      opacity: Math.min(opacity, 0.9999),
    },
  });
};

const { config, updateConfig: updateSegmentGroupConfig } =
  useGlobalSegmentGroupConfig(groupId);

const outlineOpacity = computed({
  get: () => config.value!.config!.outlineOpacity,
  set: (opacity: number) => {
    updateSegmentGroupConfig({
      outlineOpacity: opacity,
    });
  },
});

const outlineThickness = computed({
  get: () => config.value!.config!.outlineThickness,
  set: (thickness: number) => {
    updateSegmentGroupConfig({
      outlineThickness: thickness,
    });
  },
});
</script>

<template>
  <v-slider
    class="mx-4"
    label="Segment Group Fill Opacity"
    min="0"
    max="1"
    step="0.01"
    density="compact"
    hide-details
    thumb-label
    :model-value="blendConfig.opacity"
    @update:model-value="setOpacity($event)"
  />
  <v-slider
    class="mx-4"
    label="Segment Group Outline Opacity"
    min="0"
    max="1"
    step="0.01"
    density="compact"
    hide-details
    thumb-label
    v-model="outlineOpacity"
  />
  <v-slider
    class="mx-4"
    label="Segment Group Outline Thickness"
    min="0"
    max="10"
    step="1"
    density="compact"
    hide-details
    thumb-label
    v-model="outlineThickness"
  />
</template>
