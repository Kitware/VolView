<script setup lang="ts">
import { computed } from 'vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import BaseImageProperties from './BaseImageProperties.vue';
import LayerProperties from './LayerProperties.vue';

const { currentLayers, currentImageID } = useCurrentImage('global');
const layers = computed(() => [...currentLayers.value].reverse());
</script>

<template>
  <div>
    <template v-for="(layer, index) in layers" :key="layer.id">
      <v-divider v-if="index > 0" />
      <layer-properties :layer="layer" :class="index > 0 ? 'py-4' : 'pb-4'" />
    </template>
    <template v-if="currentImageID">
      <v-divider v-if="layers.length" />
      <BaseImageProperties
        :image-id="currentImageID"
        :class="layers.length ? 'py-4' : 'pb-4'"
      />
    </template>
  </div>
</template>
