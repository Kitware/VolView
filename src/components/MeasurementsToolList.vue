<script setup lang="ts" generic="ToolID extends string">
/* global ToolID:readonly */
import { computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';

const props = defineProps<{
  toolStore: AnnotationToolStore<ToolID>;
  icon: string;
}>();

const { currentImageID, currentImageMetadata } = useCurrentImage();

const tools = computed(() => {
  const byID = props.toolStore.toolByID;
  return props.toolStore.toolIDs
    .map((id) => byID[id])
    .filter((tool) => !tool.placing && tool.imageID === currentImageID.value)
    .map((tool) => {
      const { axis } = frameOfReferenceToImageSliceAndAxis(
        tool.frameOfReference,
        currentImageMetadata.value,
        {
          allowOutOfBoundsSlice: true,
        }
      ) ?? { axis: 'unknown' };
      return {
        ...tool,
        axis,
      };
    });
});

const remove = (id: ToolID) => {
  props.toolStore.removeTool(id);
};

const jumpTo = (id: ToolID) => {
  props.toolStore.jumpToTool(id);
};

const toggleHidden = (id: ToolID) => {
  const toggled = !props.toolStore.toolByID[id].hidden;
  props.toolStore.updateTool(id, { hidden: toggled });
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
          <v-col>Slice: {{ tool.slice + 1 }}</v-col>
          <v-col>Axis: {{ tool.axis }}</v-col>
        </v-row>
      </slot>
    </v-list-item-subtitle>

    <template #append>
      <v-btn variant="text" @click="toggleHidden(tool.id)">
        <v-icon v-if="tool.hidden">mdi-eye-off</v-icon>
        <v-icon v-else>mdi-eye</v-icon>
        <v-tooltip location="top" activator="parent">{{
          tool.hidden ? 'Show' : 'Hide'
        }}</v-tooltip>
      </v-btn>
      <v-btn variant="text" @click="jumpTo(tool.id)">
        <v-icon>mdi-target</v-icon>
        <v-tooltip location="top" activator="parent">Reveal Slice</v-tooltip>
      </v-btn>
      <v-btn variant="text" @click="remove(tool.id)">
        <v-icon>mdi-delete</v-icon>
        <v-tooltip location="top" activator="parent">Delete</v-tooltip>
      </v-btn>
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
