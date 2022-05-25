<template>
  <div class="overlay-no-events">
    <div>
      <PaintWidget2D
        v-if="active"
        :slice="slice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
      />
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  toRefs,
} from '@vue/composition-api';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { useViewStore } from '@/src/store/views';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import { LPSAxisDir } from '@/src/utils/lps';
import { usePaintToolStore } from '@/src/store/tools/paint';
import PaintWidget2D from './paint/PaintWidget2D.vue';

export default defineComponent({
  name: 'PaintTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    slice: {
      type: Number,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    widgetManager: {
      type: Object as PropType<vtkWidgetManager>,
      required: true,
    },
  },
  components: {
    PaintWidget2D,
  },
  setup(props) {
    const { viewId: viewID } = toRefs(props);

    const paintStore = usePaintToolStore();
    const active = computed(() => paintStore.isActive);

    // viewProxy is expected to never change over
    // the course of this component's lifespan.
    const viewStore = useViewStore();
    const viewProxy = viewStore.getViewProxy<vtkLPSView2DProxy>(viewID.value);
    if (!viewProxy) {
      throw new Error('Cannot get the view proxy');
    }

    return {
      active,
    };
  },
});
</script>

<style scoped src="@/src/assets/styles/vtk-view.css"></style>
