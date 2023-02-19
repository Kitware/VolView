<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import LayerProperties from './LayerProperties.vue';

export default defineComponent({
  name: 'LayerList',
  components: {
    LayerProperties,
  },
  setup() {
    const images = useCurrentImage().currentLayerImageIDs.value.reverse();

    return {
      images,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <layer-properties v-for="image in images" :key="image" :imageID="image">
    </layer-properties>
  </div>
</template>

<style scoped></style>
