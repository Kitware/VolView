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
    <v-menu
      v-model="contextMenu.show"
      class="position-absolute"
      :style="{
        top: `${contextMenu.y}px`,
        left: `${contextMenu.x}px`,
      }"
      close-on-click
      close-on-content-click
    >
      <v-list density="compact">
        <v-list-item @click="deleteRulerFromContextMenu">
          <v-list-item-title>Delete</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onUnmounted,
  PropType,
  reactive,
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
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { storeToRefs } from 'pinia';
import {
  FrameOfReference,
  frameOfReferenceToImageSliceAndAxis,
} from '@/src/utils/frameOfReference';
import { Ruler } from '@/src/types/ruler';
import { vec3 } from 'gl-matrix';

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
  },
  setup(props) {
    const { viewDirection, currentSlice } = toRefs(props);
    const toolStore = useToolStore();
    const rulerStore = useRulerStore();
    const { rulers, activeLabel } = storeToRefs(rulerStore);

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

    // --- context menu --- //

    const contextMenu = reactive({
      show: false,
      x: 0,
      y: 0,
      forRulerID: '',
    });

    const openContextMenu = (rulerID: string, displayXY: Vector2) => {
      [contextMenu.x, contextMenu.y] = displayXY;
      contextMenu.show = true;
      contextMenu.forRulerID = rulerID;
    };

    const deleteRulerFromContextMenu = () => {
      rulerStore.removeRuler(contextMenu.forRulerID);
    };

    // --- ruler data --- //

    // does the ruler's frame of reference match
    // the view's axis
    const doesRulerFrameMatchViewAxis = (ruler: Partial<Ruler>) => {
      if (!ruler.frameOfReference) return false;
      const rulerAxis = frameOfReferenceToImageSliceAndAxis(
        ruler.frameOfReference,
        currentImageMetadata.value,
        {
          allowOutOfBoundsSlice: true,
        }
      );
      return !!rulerAxis && rulerAxis.axis === viewAxis.value;
    };

    const currentRulers = computed(() => {
      const { lengthByID } = rulerStore;
      const curImageID = currentImageID.value;

      const rulerData = rulers.value
        .filter((ruler) => {
          // only show rulers for the current image
          // and current view axis
          return (
            ruler.imageID === curImageID && doesRulerFrameMatchViewAxis(ruler)
          );
        })
        .map((ruler) => {
          return {
            ...ruler,
            length: lengthByID[ruler.id],
          };
        });

      return rulerData;
    });

    return {
      rulers: currentRulers,
      placingRulerID,
      contextMenu,
      openContextMenu,
      deleteRulerFromContextMenu,
      onRulerPlaced,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
