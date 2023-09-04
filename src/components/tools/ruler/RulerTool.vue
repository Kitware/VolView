<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <RulerWidget2D
        v-for="ruler in rulers"
        :key="ruler.id"
        :ruler-id="ruler.id"
        :is-placing="ruler.id === placingRulerID"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(ruler.id, $event)"
        @placed="onRulerPlaced"
      />
    </svg>
    <AnnotationContextMenu ref="contextMenu" :tool-store="rulerStore" />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onUnmounted,
  PropType,
  ref,
  toRefs,
  watch,
} from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import type { Vector3 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { storeToRefs } from 'pinia';
import { FrameOfReference } from '@/src/utils/frameOfReference';
import { vec3 } from 'gl-matrix';
import {
  useContextMenu,
  useCurrentTools,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';

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
    AnnotationContextMenu,
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const rulerStore = useRulerStore();
    const { activeLabel } = storeToRefs(rulerStore);

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const isToolActive = computed(() => toolStore.currentTool === Tools.Ruler);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    const placingRulerID = ref<string | null>(null);

    // --- active ruler management --- //

    watch(
      placingRulerID,
      (id, prevId) => {
        if (prevId != null) {
          rulerStore.updateRuler(prevId, { placing: false });
        }
        if (id != null) {
          rulerStore.updateRuler(id, { placing: true });
        }
      },
      { immediate: true }
    );

    watch(
      [isToolActive, currentImageID] as const,
      ([active, imageID]) => {
        if (placingRulerID.value != null) {
          rulerStore.removeRuler(placingRulerID.value);
          placingRulerID.value = null;
        }
        if (active && imageID) {
          placingRulerID.value = rulerStore.addRuler({
            imageID,
            placing: true,
          });
        }
      },
      { immediate: true }
    );

    watch(
      [activeLabel, placingRulerID],
      ([label, placingTool]) => {
        if (placingTool != null) {
          rulerStore.updateRuler(placingTool, {
            label,
            ...(label && rulerStore.labels[label]),
          });
        }
      },
      { immediate: true }
    );

    onUnmounted(() => {
      if (placingRulerID.value != null) {
        rulerStore.removeRuler(placingRulerID.value);
        placingRulerID.value = null;
      }
    });

    const onRulerPlaced = () => {
      if (currentImageID.value) {
        placingRulerID.value = rulerStore.addRuler({
          imageID: currentImageID.value,
          placing: true,
        });
      }
    };

    // --- updating active ruler frame --- //

    // TODO useCurrentFrameOfReference(viewDirection)
    const getCurrentFrameOfReference = (): FrameOfReference => {
      const { lpsOrientation, indexToWorld } = currentImageMetadata.value;
      const planeNormal = lpsOrientation[viewDirection.value] as Vector3;

      const lpsIdx = lpsOrientation[viewAxis.value];
      const planeOrigin: Vector3 = [0, 0, 0];
      planeOrigin[lpsIdx] = currentSlice.value;
      // convert index pt to world pt
      vec3.transformMat4(planeOrigin, planeOrigin, indexToWorld);

      return {
        planeNormal,
        planeOrigin,
      };
    };

    // update active ruler's frame + slice, since the
    // active ruler is not finalized.
    watch(
      [currentSlice, placingRulerID] as const,
      ([slice, rulerID]) => {
        if (!rulerID) return;
        rulerStore.updateRuler(rulerID, {
          frameOfReference: getCurrentFrameOfReference(),
          slice,
        });
      },
      { immediate: true }
    );

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
      placingRulerID,
      onRulerPlaced,
      contextMenu,
      openContextMenu,
      rulerStore,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
