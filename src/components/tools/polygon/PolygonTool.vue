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
        @placing="onPlacementStarted"
        @placed="onToolPlaced"
        @widgetHover="onHover(tool.id, $event)"
      />
    </svg>
    <annotation-context-menu
      ref="contextMenu"
      :tool-store="activeToolStore"
      v-slot="{ context }"
    >
      <reasoned-action
        :reason="rasterizeDisabledReason(context.forToolID)"
        block
        v-slot="{ disabled }"
      >
        <v-list-item @click="rasterize(context.forToolID)" :disabled="disabled">
          <template #prepend>
            <v-icon>mdi-grid</v-icon>
          </template>
          <v-list-item-title>Rasterize</v-list-item-title>
        </v-list-item>
      </reasoned-action>
      <reasoned-action
        :reason="mergeDisabledReason"
        block
        v-slot="{ disabled }"
      >
        <v-list-item @click="mergeTools" :disabled="disabled">
          <template #prepend>
            <v-icon>mdi-vector-union</v-icon>
          </template>
          <v-list-item-title>Merge Polygons</v-list-item-title>
        </v-list-item>
      </reasoned-action>
    </annotation-context-menu>
    <annotation-info :info="overlayInfo" :tool-store="activeToolStore" />
  </div>
</template>

<script lang="ts">
import { useSegmentStore } from '@/src/segmentation/segments';
import { computed, defineComponent, onUnmounted, PropType, toRefs } from 'vue';
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
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useActionHeld } from '@/src/composables/useKeyboardShortcuts';
import { Maybe } from '@/src/types';
import { useViewLocator } from '@/src/composables/useViewLocator';
import { locatorPatch } from '@/src/core/annotations/locator';
import { watchImmediate } from '@vueuse/core';
import { type ToolID } from '@/src/types/annotation-tool';
import PolygonWidget2D from '@/src/components/tools/polygon/PolygonWidget2D.vue';
import {
  rasterizePolygon,
  rasterizeTargetDisabledReason,
} from '@/src/segmentation/editing/rasterizePolygon';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';

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
    ReasonedAction,
  },
  setup(props) {
    const { viewDirection, imageId, viewId } = toRefs(props);
    const toolStore = useToolStore();
    const activeToolStore = useActiveToolStore();

    const { locator, frame, slice } = useViewLocator(viewId, imageId);

    const isToolActive = computed(
      () =>
        toolStore.currentTool === toolType &&
        !useSegmentStore().initializationReason(imageId.value)
    );
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- active tool management --- //

    const placingTool = usePlacingAnnotationTool(
      activeToolStore,
      computed(() => {
        if (!imageId.value) return {};
        return {
          imageID: imageId.value,
          ...locatorPatch(locator.value),
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

    const mergeDisabledReason = computed(() =>
      activeToolStore.mergeableTools.length >= 1
        ? ''
        : 'Shift select multiple polygons that overlap and belong to the same segment.'
    );

    const imageCache = useImageCacheStore();
    function rasterizeFrame(toolId: ToolID) {
      const tool = activeToolStore.toolByID[toolId];
      const metadata = tool && imageCache.getImageMetadata(tool.imageID);
      return metadata
        ? frameOfReferenceToImageSliceAndAxis(tool.frameOfReference, metadata, {
            allowOutOfBoundsSlice: true,
          })
        : null;
    }

    function rasterizeDisabledReason(toolId: ToolID) {
      const tool = activeToolStore.toolByID[toolId];
      if (!tool) return 'No polygon is available for rasterization';
      const loading = useSegmentStore().initializationReason(tool.imageID);
      if (loading) return loading;
      if (isCineImage(tool.imageID))
        return 'Rasterization is not supported for cine images';
      if (!rasterizeFrame(toolId))
        return 'The polygon must align with a loaded image slice';
      return rasterizeTargetDisabledReason(tool.imageID, tool.segmentId);
    }

    function rasterize(toolId: ToolID) {
      const tool = activeToolStore.toolByID[toolId];
      if (
        !tool ||
        isCineImage(tool.imageID) ||
        useSegmentStore().initializationReason(tool.imageID)
      )
        return;
      const plane = rasterizeFrame(toolId);
      if (!plane) return;

      const { imageID, segmentId } = tool;
      const rasterized = rasterizePolygon({
        imageId: imageID,
        segmentId,
        points: activeToolStore.getPoints(toolId),
        slice: tool.slice,
        viewAxis: plane.axis,
      });
      // Record where the voxels landed; a refused rasterize returns the input.
      if (rasterized.segmentId && rasterized.segmentId !== segmentId) {
        activeToolStore.updateTool(toolId, { segmentId: rasterized.segmentId });
      }
    }

    return {
      tools: currentTools,
      placingToolID: placingTool.id,
      onPlacementStarted: placingTool.beginPlacement,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      mergeTools: activeToolStore.mergeSelectedTools,
      mergeDisabledReason,
      activeToolStore,
      onHover,
      overlayInfo,
      rasterize,
      rasterizeDisabledReason,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
