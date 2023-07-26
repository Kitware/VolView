<script setup lang="ts">
import { computed } from 'vue';
import { StoreState, StoreActions } from 'pinia';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useAnnotationTool } from '../store/tools/useAnnotationTool';
import { AnnotationTool } from '../types/annotation-tool';

type ToolFactory = (...args: any) => AnnotationTool;
type UseAnnotationTool = ReturnType<
  typeof useAnnotationTool<ToolFactory, unknown>
>;
type AnnotationToolStore = StoreState<UseAnnotationTool> &
  StoreActions<UseAnnotationTool>;

const props = defineProps<{
  toolStore: AnnotationToolStore;
  icon: string;
}>();

const { currentImageID } = useCurrentImage();

const tools = computed(() => {
  const byID = props.toolStore.toolByID;
  return props.toolStore.toolIDs
    .map((id) => byID[id])
    .filter((tool) => !tool.placing && tool.imageID === currentImageID.value);
});

const remove = (id: string) => {
  props.toolStore.removeTool(id);
};

const jumpTo = (id: string) => {
  props.toolStore.jumpToTool(id);
};
</script>

<template>
  <v-list-item v-for="tool in tools" :key="tool.id" lines="two">
    <template #prepend>
      <v-icon class="tool-icon">{{ icon }}</v-icon>
      <div class="color-dot mr-3" :style="{ backgroundColor: tool.color }" />
    </template>
    <v-list-item-title v-bind="$attrs">
      {{ tool.labelName }}
    </v-list-item-title>

    <v-list-item-subtitle>
      <slot name="details" v-bind="{ tool }">
        <v-row>
          <v-col>ID: {{ tool.id }}</v-col>
        </v-row>
      </slot>
    </v-list-item-subtitle>
    <template #append>
      <v-row>
        <v-btn
          class="mr-2"
          icon="mdi-target"
          variant="text"
          @click="jumpTo(tool.id)"
        >
          <v-icon>mdi-target</v-icon>
          <v-tooltip location="top" activator="parent">
            Reveal Slice
          </v-tooltip>
        </v-btn>
        <v-btn icon="mdi-delete" variant="text" @click="remove(tool.id)">
          <v-icon>mdi-delete</v-icon>
          <v-tooltip location="top" activator="parent">Delete</v-tooltip>
        </v-btn>
      </v-row>
    </template>
  </v-list-item>
</template>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
.empty-state {
  text-align: center;
}

.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
}

.tool-icon {
  margin-inline-end: 12px;
}
</style>
