<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import ToolButton from '@/src/components/ToolButton.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useCropStore } from '@/src/store/tools/crop';

export default defineComponent({
  components: {
    ToolButton,
  },
  setup() {
    const { currentImageID } = useCurrentImage();
    const cropStore = useCropStore();

    const resetCrop = () => {
      const imageID = currentImageID.value;
      if (imageID) {
        cropStore.resetCropping(imageID);
      }
    };

    return {
      resetCrop,
    };
  },
});
</script>

<template>
  <v-card dark>
    <tool-button
      size="40"
      icon="mdi-restore"
      name="Reset Crop"
      @click="resetCrop"
    />
  </v-card>
</template>
