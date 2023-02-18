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
    const { currentLayerImageIDs } = useCurrentImage();

    return {
      currentLayerImageIDs,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <layer-properties
      v-for="imageID in currentLayerImageIDs"
      :key="imageID"
      :imageID="imageID"
    >
    </layer-properties>
  </div>
</template>

<style scoped></style>
