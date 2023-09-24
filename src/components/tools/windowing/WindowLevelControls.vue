<script lang="ts">
import { defineComponent } from 'vue';
import ToolButton from '@/src/components/ToolButton.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import useWindowingStore from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';

export default defineComponent({
  components: {
    ToolButton,
  },
  setup() {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();

    const resetWindowLevel = () => {
      const imageID = currentImageID.value;
      if (imageID) {
        // Get the relevant view ids
        const viewIDs = viewStore.viewIDs.filter(
          (viewID) => !!windowingStore.getConfig(viewID, imageID)
        );
        // Reset the window/level for all views
        viewIDs.map((viewID) =>
          windowingStore.resetWindowLevel(viewID, imageID)
        );
      }
    };

    return {
      resetWindowLevel,
    };
  },
});
</script>

<template>
  <v-card dark>
    <tool-button
      size="40"
      icon="mdi-restore"
      name="Reset Window & Level"
      @click="resetWindowLevel"
    />
  </v-card>
</template>
