<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useGlobalLayerColorConfig } from '@/src/composables/useGlobalLayerColorConfig';
import { useGlobalSegmentGroupConfig } from '@/src/store/view-configs/segmentGroups';

const props = defineProps<{
  groupId: string;
  selected: string[];
}>();

const { groupId, selected } = toRefs(props);

const { sampledConfig } = useGlobalLayerColorConfig(groupId);

const blendConfig = computed(() => sampledConfig.value!.config!.blendConfig);

const layerUpdateFunctions = computed(() =>
  selected.value.map((id) => {
    return useGlobalLayerColorConfig(id).updateConfig;
  })
);

const setOpacity = (opacity: number) => {
  layerUpdateFunctions.value.forEach((updateFn) => {
    updateFn({
      blendConfig: {
        ...blendConfig.value,
        // 1.0 puts us in Opaque render pass which changes stack order.
        opacity: Math.min(opacity, 0.9999),
      },
    });
  });
};

const { config } = useGlobalSegmentGroupConfig(groupId);

const groupUpdateFunctions = computed(() =>
  selected.value.map((id) => {
    return useGlobalSegmentGroupConfig(id).updateConfig;
  })
);

const outlineOpacity = computed({
  get: () => config.value!.config!.outlineOpacity,
  set: (opacity: number) => {
    groupUpdateFunctions.value.forEach((updateFn) => {
      updateFn({
        outlineOpacity: opacity,
      });
    });
  },
});

const outlineThickness = computed({
  get: () => config.value!.config!.outlineThickness,
  set: (thickness: number) => {
    groupUpdateFunctions.value.forEach((updateFn) => {
      updateFn({
        outlineThickness: thickness,
      });
    });
  },
});
</script>

<template>
  <v-slider
    class="mx-4"
    label="Fill Opacity"
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
    label="Outline Opacity"
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
    label="Outline Thickness"
    min="0"
    max="10"
    step="1"
    density="compact"
    hide-details
    thumb-label
    v-model="outlineThickness"
  />
</template>
