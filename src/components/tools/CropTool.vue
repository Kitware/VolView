<script lang="ts">
import { useViewStore } from '@/src/store/views';
import { computed, defineComponent, toRefs, watch } from '@vue/composition-api';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useCropStore } from '@/src/store/tools/crop';
import CropSVG2D from './crop/CropSVG2D.vue';
import Crop3D from './crop/Crop3D.vue';

export default defineComponent({
  props: {
    viewId: {
      type: String,
      required: true,
    },
  },
  components: {
    CropSVG2D,
    Crop3D,
  },
  setup(props) {
    const { viewId: viewID } = toRefs(props);

    const { currentImageID } = useCurrentImage();
    const cropStore = useCropStore();

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
      viewType,
    };
  },
});
</script>

<template>
  <svg class="overlay-no-events">
    <CropSVG2D v-if="viewType === '2D'" :view-id="viewId" />
    <Crop3D v-if="viewType === '3D'" :view-id="viewId" />
  </svg>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
