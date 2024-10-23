<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useGlobalLayerColorConfig } from '@/src/composables/useGlobalLayerColorConfig';

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
</script>

<template>
  <v-slider
    class="ma-4"
    label="Segment Group Opacity"
    min="0"
    max="1"
    step="0.01"
    density="compact"
    hide-details
    thumb-label
    :model-value="blendConfig.opacity"
    @update:model-value="setOpacity($event)"
  />
</template>
