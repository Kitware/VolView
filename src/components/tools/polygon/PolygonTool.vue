<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <polygon-widget-2D
        v-for="tool in tools"
        :key="tool.id"
        :tool-id="tool.id"
        :is-placing="tool.id === placingToolID"
        :image-id="imageId"
        :view-id="viewId"
        :view-direction="viewDirection"
        @contextmenu="openContextMenu(tool.id, $event)"
        @placed="onToolPlaced"
        @widgetHover="onHover(tool.id, $event)"
      />
    </svg>
    <annotation-context-menu
      ref="contextMenu"
      :tool-store="activeToolStore"
      v-slot="{ context }"
    >
      <v-list-item
        v-if="!isCurrentImageCine"
        @click="rasterize(context.forToolID)"
      >
        <template #prepend>
          <v-icon>mdi-grid</v-icon>
        </template>
        <v-list-item-title>Rasterize</v-list-item-title>
      </v-list-item>
      <v-tooltip
        :disabled="mergePossible"
        text="Shift select multiple polygons that overlap and have the same label."
      >
        <template v-slot:activator="{ props }">
          <div v-bind="props">
            <v-list-item @click="mergeTools" :disabled="!mergePossible">
              <template v-slot:prepend>
                <v-icon>mdi-vector-union</v-icon>
              </template>

              <v-list-item-title>Merge Polygons</v-list-item-title>
            </v-list-item>
          </div>
        </template>
      </v-tooltip>
    </annotation-context-menu>
    <annotation-info :info="overlayInfo" :tool-store="activeToolStore" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onUnmounted, PropType, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import {
  useContextMenu,
  useCurrentTools,
  useHover,
  usePlacingAnnotationTool,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import AnnotationInfo from '@/src/components/tools/AnnotationInfo.vue';
import { useActionHeld } from '@/src/composables/useKeyboardShortcuts';
import { Maybe } from '@/src/types';
import { useViewLocator } from '@/src/composables/useViewLocator';
import { locatorPatch } from '@/src/core/annotations/locator';
import { watchImmediate } from '@vueuse/core';
import { type ToolID } from '@/src/types/annotation-tool';
import PolygonWidget2D from '@/src/components/tools/polygon/PolygonWidget2D.vue';
import { rasterizePolygon } from '@/src/components/tools/polygon/rasterizeTarget';
import { isCineImage } from '@/src/core/cine/isCineImage';

const useActiveToolStore = usePolygonStore;
const toolType = Tools.Polygon;

export default defineComponent({
  name: 'PolygonTool',
  props: {
    viewId: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    imageId: String as PropType<Maybe<string>>,
  },
  components: {
    PolygonWidget2D,
    AnnotationContextMenu,
    AnnotationInfo,
  },
  setup(props) {
    const { viewDirection, imageId, viewId } = toRefs(props);
    const toolStore = useToolStore();
    const activeToolStore = useActiveToolStore();
    const { activeLabel } = storeToRefs(activeToolStore);

    const { locator, frame, slice } = useViewLocator(viewId, imageId);

    const isToolActive = computed(() => toolStore.currentTool === toolType);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- active tool management --- //

    const placingTool = usePlacingAnnotationTool(
      activeToolStore,
      computed(() => {
        if (!imageId.value) return {};
        return {
          imageID: imageId.value,
          ...locatorPatch(locator.value),
          label: activeLabel.value,
          ...(activeLabel.value && activeToolStore.labels[activeLabel.value]),
        };
      })
    );

    watchImmediate([isToolActive, imageId] as const, ([active, imageID]) => {
      placingTool.remove();
      if (active && imageID) {
        placingTool.add();
      }
    });

    onUnmounted(() => {
      placingTool.remove();
    });

    const mergeKey = useActionHeld('mergeNewPolygon');

    const onToolPlaced = () => {
      if (imageId.value) {
        const newToolId = placingTool.id.value;
        placingTool.commit();
        placingTool.add();
        if (mergeKey.value && newToolId) {
          activeToolStore.mergeWithOtherTools(newToolId);
        }
      }
    };

    // ---  //

    const { contextMenu, openContextMenu: baseOpenContextMenu } =
      useContextMenu();

    const rectangleStore = useRectangleStore();
    const shouldSuppressInteraction = (id: ToolID) => {
      const rectanglePlacing = rectangleStore.tools.some(
        (tool) => tool.placing && tool.firstPoint && tool.secondPoint
      );
      if (rectanglePlacing) return true;
      if (placingTool.id.value && id !== placingTool.id.value) {
        const placingToolData = activeToolStore.toolByID[placingTool.id.value];
        if (placingToolData?.points?.length > 0) return true;
      }
      return false;
    };

    const openContextMenu = (id: ToolID, event: any) => {
      if (!shouldSuppressInteraction(id)) baseOpenContextMenu(id, event);
    };

    const currentTools = useCurrentTools(
      activeToolStore,
      viewAxis,
      computed(() => (placingTool.id.value ? [placingTool.id.value] : [])),
      frame
    );

    const { onHover: baseOnHover, overlayInfo } = useHover(currentTools, slice);

    const onHover = (id: ToolID, event: any) => {
      if (shouldSuppressInteraction(id)) {
        baseOnHover(id, { ...event, hovering: false });
        return;
      }
      baseOnHover(id, event);
    };

    const mergePossible = computed(
      () => activeToolStore.mergeableTools.length >= 1
    );

    const isCurrentImageCine = computed(() => isCineImage(imageId.value));

    function rasterize(toolId: ToolID) {
      if (!imageId.value) {
        throw new Error('No image ID available for rasterization');
      }
      if (isCurrentImageCine.value) {
        throw new Error('Rasterization is not supported for cine images');
      }

      const tool = activeToolStore.toolByID[toolId];
      const rasterized = rasterizePolygon({
        imageId: imageId.value,
        segmentId: tool?.label,
        points: activeToolStore.getPoints(toolId),
        slice: slice.value,
        viewAxis: viewAxis.value,
      });
      // The polygon records where its voxels actually landed. This covers an
      // unlabeled polygon and one whose segment was deleted, whose stale id
      // would otherwise outlive the segment it names.
      if (tool && tool.label !== rasterized.segmentId) {
        activeToolStore.updateTool(toolId, { label: rasterized.segmentId });
      }
    }

    return {
      tools: currentTools,
      placingToolID: placingTool.id,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      mergeTools: activeToolStore.mergeSelectedTools,
      mergePossible,
      activeToolStore,
      onHover,
      overlayInfo,
      rasterize,
      isCurrentImageCine,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
