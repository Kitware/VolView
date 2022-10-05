<script lang="ts">
import { useViewStore } from '@/src/store/views';
import { computed, defineComponent, toRefs, watch } from '@vue/composition-api';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useCropStore } from '@/src/store/tools/crop';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import Crop2D from './crop/Crop2D.vue';
import Crop3D from './crop/Crop3D.vue';

export default defineComponent({
  props: {
    viewId: {
      type: String,
      required: true,
    },
  },
  components: {
    Crop2D,
    Crop3D,
  },
  setup(props) {
    const { viewId: viewID } = toRefs(props);

    const { currentImageID } = useCurrentImage();
    const cropStore = useCropStore();
    const toolStore = useToolStore();

    const active = computed(() => toolStore.currentTool === Tools.Crop);

    watch(
      currentImageID,
      (imageID) => {
        if (imageID && !(imageID in cropStore.croppingByImageID)) {
          cropStore.resetCropping(imageID);
        }
      },
      { immediate: true }
    );

    const viewType = computed(() => {
      const viewStore = useViewStore();
      return viewStore.viewSpecs[viewID.value].viewType;
    });

    return {
      active,
      viewType,
    };
  },
});
</script>

<template>
  <svg class="overlay-no-events">
    <crop-2D v-if="active && viewType === '2D'" :view-id="viewId" />
    <crop-3D v-if="active && viewType === '3D'" :view-id="viewId" />
  </svg>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
