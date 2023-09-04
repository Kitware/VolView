<script setup lang="ts" generic="ToolID extends string">
/* global ToolID:readonly */
import { shallowReactive } from 'vue';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { ContextMenuEvent } from '@/src/types/annotation-tool';
import { WidgetAction } from '@/src/vtk/ToolWidgetUtils/utils';

const props = defineProps<{
  toolStore: AnnotationToolStore<ToolID>;
}>();

const contextMenu = shallowReactive({
  show: false,
  x: 0,
  y: 0,
  forToolID: '' as ToolID,
  widgetActions: [] as Array<WidgetAction>,
});

const open = (id: ToolID, event: ContextMenuEvent) => {
  const { displayXY } = event;
  [contextMenu.x, contextMenu.y] = displayXY;
  contextMenu.forToolID = id;
  contextMenu.show = true;
  contextMenu.widgetActions = event.widgetActions;
};

defineExpose({
  open,
});

const deleteToolFromContextMenu = () => {
  props.toolStore.removeTool(contextMenu.forToolID);
};

const hideToolFromContextMenu = () => {
  props.toolStore.updateTool(contextMenu.forToolID, {
    hidden: true,
  });
};
</script>

<template>
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
      <v-list-item @click="hideToolFromContextMenu">
        <v-list-item-title>Hide</v-list-item-title>
      </v-list-item>
      <v-list-item @click="deleteToolFromContextMenu">
        <v-list-item-title>Delete Annotation</v-list-item-title>
      </v-list-item>
      <!-- Optional items below stable item for muscle memory  -->
      <v-list-item
        v-for="action in contextMenu.widgetActions"
        @click="action.func"
        :key="action.name"
      >
        <v-list-item-title>{{ action.name }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
