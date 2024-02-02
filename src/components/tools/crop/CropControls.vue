<script lang="ts">
import { defineComponent } from 'vue';
import ControlButton from '@/src/components/ControlButton.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useCropStore } from '@/src/store/tools/crop';

export default defineComponent({
  components: {
    ControlButton,
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
    <control-button
      size="40"
      icon="mdi-restore"
      name="Reset Crop"
      @click="resetCrop"
    />
  </v-card>
</template>
