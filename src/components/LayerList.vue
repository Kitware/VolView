<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { useDatasetStore } from '../store/datasets';
import LayerProperties from './LayerProperties.vue';

export default defineComponent({
  name: 'LayerList',
  components: {
    LayerProperties,
  },
  setup() {
    const dataStore = useDatasetStore();
    const layers = computed(() => [...dataStore.layers].reverse());

    return {
      layers,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <layer-properties v-for="layer in layers" :key="layer" :layerID="layer">
    </layer-properties>
  </div>
</template>
