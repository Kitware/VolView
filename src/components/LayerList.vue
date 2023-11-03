<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import LayerProperties from './LayerProperties.vue';

export default defineComponent({
  name: 'LayerList',
  components: {
    LayerProperties,
  },
  setup() {
    const { currentLayers } = useCurrentImage();
    const layers = computed(() => [...currentLayers.value].reverse());

    return {
      layers,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <layer-properties
      v-for="layer in layers"
      :key="layer.id"
      :layer="layer"
      class="py-4"
    >
    </layer-properties>
  </div>
</template>
