<script lang="ts">
import { useViewStore } from '@/src/store/views';
import { PropType, computed, defineComponent, toRefs } from 'vue';
import { watchImmediate } from '@vueuse/core';
import { useCropStore } from '@/src/store/tools/crop';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { Maybe } from '@/src/types';
import Crop2D from './Crop2D.vue';
import Crop3D from './Crop3D.vue';

export default defineComponent({
  props: {
    viewId: {
      type: String,
      required: true,
    },
    imageId: String as PropType<Maybe<string>>,
  },
  components: {
    Crop2D,
    Crop3D,
  },
  setup(props) {
    const { viewId: viewID, imageId } = toRefs(props);

    const cropStore = useCropStore();
    const toolStore = useToolStore();

    const active = computed(() => toolStore.currentTool === Tools.Crop);

    watchImmediate(imageId, (id) => {
      if (id && !(id in cropStore.croppingByImageID)) {
        cropStore.resetCropping(id);
      }
    });

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
    <crop-2D
      v-if="active && viewType === '2D'"
      :view-id="viewId"
      :image-id="imageId"
    />
    <crop-3D
      v-if="active && viewType === '3D'"
      :view-id="viewId"
      :image-id="imageId"
    />
  </svg>
</template>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
