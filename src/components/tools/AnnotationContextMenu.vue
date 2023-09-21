<script setup lang="ts">
import { computed, shallowReactive } from 'vue';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import {
  ContextMenuEvent,
  WidgetAction,
} from '@/src/vtk/ToolWidgetUtils/types';
import { ToolID } from '@/src/types/annotation-tool';

const props = defineProps<{
  toolStore: AnnotationToolStore;
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

const tool = computed(() => {
  return props.toolStore.toolByID[contextMenu.forToolID];
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
    v-if="tool"
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
      <v-list-item>
        <template v-slot:prepend>
          <div
            class="color-dot v-icon"
            :style="{ backgroundColor: tool.color }"
          />
        </template>
        <v-list-item-title class="v-list-item--disabled">
          {{ tool.labelName }}
        </v-list-item-title>
      </v-list-item>

      <!-- Separate informative items from interactive items -->
      <v-divider></v-divider>

      <v-list-item @click="hideToolFromContextMenu">
        <template v-slot:prepend>
          <v-icon>mdi-eye</v-icon>
        </template>
        <v-list-item-title>Hide</v-list-item-title>
      </v-list-item>

      <v-list-item @click="deleteToolFromContextMenu">
        <template v-slot:prepend>
          <v-icon>mdi-delete</v-icon>
        </template>
        <v-list-item-title>Delete Annotation</v-list-item-title>
      </v-list-item>

      <!-- Optional items below stable items for muscle memory  -->
      <v-list-item
        v-for="action in contextMenu.widgetActions"
        @click="action.func"
        :key="action.name"
      >
        <template v-slot:prepend>
          <v-icon></v-icon>
        </template>
        <v-list-item-title>{{ action.name }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style scoped>
.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
  opacity: 1 !important;
}
</style>
