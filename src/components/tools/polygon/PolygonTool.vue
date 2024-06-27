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
    <annotation-context-menu ref="contextMenu" :tool-store="activeToolStore">
      <v-list-item @click="mergeTools" v-if="mergePossible">
        <template v-slot:prepend>
          <v-icon>mdi-vector-union</v-icon>
        </template>
        <v-list-item-title>Merge Polygons</v-list-item-title>
      </v-list-item>
    </annotation-context-menu>
    <annotation-info :info="overlayInfo" :tool-store="activeToolStore" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onUnmounted, PropType, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import { useImage } from '@/src/composables/useCurrentImage';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  useContextMenu,
  useCurrentTools,
  useHover,
  usePlacingAnnotationTool,
} from '@/src/composables/annotationTool';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import AnnotationInfo from '@/src/components/tools/AnnotationInfo.vue';
import { useFrameOfReference } from '@/src/composables/useFrameOfReference';
import { Maybe } from '@/src/types';
import { useSliceInfo } from '@/src/composables/useSliceInfo';
import { watchImmediate } from '@vueuse/core';
import PolygonWidget2D from './PolygonWidget2D.vue';

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

    const sliceInfo = useSliceInfo(viewId, imageId);
    const slice = computed(() => sliceInfo.value?.slice ?? 0);

    const { metadata: imageMetadata } = useImage(imageId);
    const isToolActive = computed(() => toolStore.currentTool === toolType);
    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- active tool management --- //

    const frameOfReference = useFrameOfReference(
      viewDirection,
      slice,
      imageMetadata
    );

    const placingTool = usePlacingAnnotationTool(
      activeToolStore,
      computed(() => {
        if (!imageId.value) return {};
        return {
          imageID: imageId.value,
          frameOfReference: frameOfReference.value,
          slice: slice.value,
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

    const onToolPlaced = () => {
      if (imageId.value) {
        placingTool.commit();
        placingTool.add();
      }
    };

    // ---  //

    const { contextMenu, openContextMenu } = useContextMenu();

    const currentTools = useCurrentTools(activeToolStore, viewAxis);

    const { onHover, overlayInfo } = useHover(currentTools, slice);

    const mergePossible = computed(
      () => activeToolStore.mergeableTools.length > 1
    );

    return {
      tools: currentTools,
      placingToolID: placingTool.id,
      onToolPlaced,
      contextMenu,
      openContextMenu,
      mergeTools: activeToolStore.mergeTools,
      mergePossible,
      activeToolStore,
      onHover,
      overlayInfo,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
