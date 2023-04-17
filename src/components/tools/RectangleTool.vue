<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <RulerSVG2D
        v-for="ruler in rulers"
        :key="ruler.id"
        v-show="currentSlice === ruler.slice"
        :view-id="viewId"
        :point1="ruler.firstPoint"
        :point2="ruler.secondPoint"
        :color="ruler.color"
        :length="ruler.length"
      />
      <RulerSVG2D
        v-if="placingRuler"
        :key="placingRuler.id"
        :view-id="viewId"
        :point1="placingRuler.firstPoint"
        :point2="placingRuler.secondPoint"
        :color="placingRuler.color"
      />
    </svg>
    <RulerWidget2D
      v-for="ruler in rulers"
      :key="ruler.id"
      :ruler-id="ruler.id"
      :current-slice="currentSlice"
      :view-id="viewId"
      :view-direction="viewDirection"
      :widget-manager="widgetManager"
      @contextmenu="openContextMenu(ruler.id, $event)"
    />
    <RulerWidget2D
      v-if="placingRuler"
      :key="placingRuler.id"
      :ruler-id="placingRuler.id"
      :current-slice="currentSlice"
      :view-id="viewId"
      :view-direction="viewDirection"
      :widget-manager="widgetManager"
    />
    <v-menu
      v-model="contextMenu.show"
      :position-x="contextMenu.x"
      :position-y="contextMenu.y"
      absolute
      offset-y
      close-on-click
      close-on-content-click
    >
      <v-list dense>
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
  PropType,
  reactive,
  ref,
  toRefs,
  watch,
} from '@vue/composition-api';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import RulerSVG2D from '@/src/components/tools/ruler/RulerSVG2D.vue';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { Vector2 } from '@kitware/vtk.js/types';
import { LPSAxisDir } from '@/src/types/lps';
import { storeToRefs } from 'pinia';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { Ruler } from '@/src/types/ruler';

export default defineComponent({
  name: 'RectangleTool',
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
    RulerSVG2D,
  },
  setup(props) {
    const { viewDirection } = toRefs(props);
    const toolStore = useToolStore();
    const rulerStore = useRulerStore();
    const { placingRulerByID, rulers } = storeToRefs(rulerStore);

    const placingRulerID = ref<string | null>(null);
    const placingRuler = computed(
      () => placingRulerID.value && placingRulerByID.value[placingRulerID.value]
    );

    const { currentImageID, currentImageMetadata } = useCurrentImage();
    const isToolActive = computed(
      () => toolStore.currentTool === Tools.Rectangle
    );
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    watch(
      isToolActive,
      (active) => {
        if (active) {
          placingRulerID.value = rulerStore.createPlacingRuler();
        } else if (placingRulerID.value != null) {
          rulerStore.removeRuler(placingRulerID.value);
        }
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
      placingRuler,
      contextMenu,
      openContextMenu,
      deleteRulerFromContextMenu,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
