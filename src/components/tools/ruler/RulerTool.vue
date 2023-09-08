<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <ruler-widget-2D
        v-for="ruler in rulers"
        :key="ruler.id"
        :ruler-id="ruler.id"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(ruler.id, $event)"
      />
      <placing-ruler-widget-2D
        v-if="isToolActive"
        :current-slice="currentSlice"
        :color="activeLabelColor"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @placed="onRulerPlaced"
      />
    </svg>
    <annotation-context-menu ref="contextMenu" :tool-store="rulerStore" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import PlacingRulerWidget2D from '@/src/components/tools/ruler/PlacingRulerWidget2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { LPSAxisDir } from '@/src/types/lps';
import { storeToRefs } from 'pinia';
import {
  useContextMenu,
  useCurrentTools,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import { RulerInitState } from '@/src/components/tools/ruler/common';
import { useCurrentFrameOfReference } from '@/src/composables/useCurrentFrameOfReference';

export default defineComponent({
  name: 'RulerTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    currentSlice: {
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
    RulerWidget2D,
    PlacingRulerWidget2D,
    AnnotationContextMenu,
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const rulerStore = useRulerStore();
    const { activeLabel } = storeToRefs(rulerStore);

    const { currentImageID } = useCurrentImage();
    const isToolActive = computed(() => toolStore.currentTool === Tools.Ruler);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    const currentFrameOfReference = useCurrentFrameOfReference(
      viewDirection,
      currentSlice
    );

    const onRulerPlaced = (initState: RulerInitState) => {
      if (!currentImageID.value) return;
      rulerStore.addRuler({
        imageID: currentImageID.value,
        frameOfReference: currentFrameOfReference.value,
        slice: currentSlice.value,
        label: activeLabel.value,
        color: activeLabel.value
          ? rulerStore.labels[activeLabel.value].color
          : undefined,
        firstPoint: initState.firstPoint,
        secondPoint: initState.secondPoint,
      });
    };

    // --- right-click menu --- //

    const { contextMenu, openContextMenu } = useContextMenu();

    // --- ruler data --- //

    const currentTools = useCurrentTools(rulerStore, viewAxis);

    const currentRulers = computed(() => {
      const { lengthByID } = rulerStore;
      return currentTools.value.map((ruler) => ({
        ...ruler,
        length: lengthByID[ruler.id],
      }));
    });

    return {
      rulers: currentRulers,
      isToolActive,
      activeLabelColor: computed(() => {
        return activeLabel.value && rulerStore.labels[activeLabel.value].color;
      }),
      onRulerPlaced,
      contextMenu,
      openContextMenu,
      rulerStore,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
