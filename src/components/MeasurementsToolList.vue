<script setup lang="ts">
import { computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import MeasurementToolDetails from './MeasurementToolDetails.vue';

type AnnotationToolConfig = {
  store: AnnotationToolStore<string>;
  icon: string;
  details?: typeof MeasurementToolDetails;
};

export type AnnotationTools = Array<AnnotationToolConfig>;

const props = defineProps<{
  tools: AnnotationTools;
}>();

const { currentImageID, currentImageMetadata } = useCurrentImage();

// Filter and add axis for specific annotation type
const getTools = (toolStore: AnnotationToolStore<string>) => {
  const byID = toolStore.toolByID;
  return toolStore.toolIDs
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
};

// Flatten all tool types and add actions
const tools = computed(() => {
  return props.tools.flatMap(
    ({ store, icon, details = MeasurementToolDetails }) => {
      const toolsWithAxis = getTools(store);
      return toolsWithAxis.map((tool) => ({
        ...tool,
        icon,
        details,
        remove: () => store.removeTool(tool.id),
        jumpTo: () => store.jumpToTool(tool.id),
        toggleHidden: () => {
          const toggled = !store.toolByID[tool.id].hidden;
          store.updateTool(tool.id, { hidden: toggled });
        },
      }));
    }
  );
});
</script>

<template>
  <v-list-item v-for="tool in tools" :key="tool.id">
    <v-container>
      <v-row class="align-center main-row">
        <v-icon class="tool-icon">{{ tool.icon }}</v-icon>
        <div class="color-dot mr-3" :style="{ backgroundColor: tool.color }" />

        <v-list-item-title v-bind="$attrs">
          {{ tool.labelName }}
        </v-list-item-title>

        <span class="ml-auto actions">
          <v-btn icon variant="text" @click="tool.toggleHidden()">
            <v-icon v-if="tool.hidden">mdi-eye-off</v-icon>
            <v-icon v-else>mdi-eye</v-icon>
            <v-tooltip location="top" activator="parent">{{
              tool.hidden ? 'Show' : 'Hide'
            }}</v-tooltip>
          </v-btn>
          <v-btn icon variant="text" @click="tool.jumpTo()">
            <v-icon>mdi-target</v-icon>
            <v-tooltip location="top" activator="parent">
              Reveal Slice
            </v-tooltip>
          </v-btn>
          <v-btn icon variant="text" @click="tool.remove()">
            <v-icon>mdi-delete</v-icon>
            <v-tooltip location="top" activator="parent">Delete</v-tooltip>
          </v-btn>
        </span>
      </v-row>

      <v-row class="mt-4">
        <v-list-item-subtitle class="w-100">
          <component :is="tool.details" :tool="tool" />
        </v-list-item-subtitle>
      </v-row>
    </v-container>
  </v-list-item>
</template>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
.main-row {
  flex-wrap: nowrap;
}

.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
  flex-shrink: 0;
}

.tool-icon {
  margin-inline-end: 12px;
  opacity: var(--v-medium-emphasis-opacity);
}

.actions {
  flex-shrink: 0;
}
</style>
