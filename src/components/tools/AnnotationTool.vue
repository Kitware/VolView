<script setup lang="ts" generic="ToolID extends string">
/* global ToolID:readonly */
import { computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import RectangleWidget2D from './rectangle/RectangleWidget2D.vue';

const props = defineProps<{
  viewId: string;
  currentSlice: number;
  viewDirection: LPSAxisDir;
  widgetManager: vtkWidgetManager;

  toolStore: AnnotationToolStore<ToolID>;
  svgComponent: InstanceType<typeof RectangleWidget2D>;
}>();

// how to type a component with props?
// https://github.com/vuejs/core/issues/8373#issuecomment-1597800113
const svgComponentAny = computed(() => props.svgComponent as any);
</script>

<template>
  <div class="overlay-no-events">
    <svg class="overlay-no-events">
      <component
        :is="svgComponentAny"
        v-for="tool in tools"
        :key="tool.id"
        :tool-id="tool.id"
        :is-placing="tool.id === placingToolID"
        :current-slice="currentSlice"
        :view-id="viewId"
        :view-direction="viewDirection"
        :widget-manager="widgetManager"
        @contextmenu="openContextMenu(tool.id, $event)"
        @placed="onToolPlaced"
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
        <v-list-item @click="deleteToolFromContextMenu">
          <v-list-item-title>Delete</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>
