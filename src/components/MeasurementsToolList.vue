<script setup lang="ts">
import { computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { nonNullable } from '@/src/utils/index';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useAnnotationToolStore } from '@/src/store/tools';
import {
  useMultipleToolSelection,
  MultipleSelectionState,
} from '@/src/composables/useMultipleToolSelection';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import type { Maybe } from '@/src/types';
import MeasurementToolDetails from './MeasurementToolDetails.vue';
import { AnnotationTool } from '../types/annotation-tool';

type AnnotationToolConfig = {
  type: AnnotationToolType;
  icon: string;
  details?: typeof MeasurementToolDetails;
};

export type AnnotationTools = Array<AnnotationToolConfig>;

const props = defineProps<{
  tools: AnnotationTools;
}>();

const { currentImageID, currentImageMetadata } = useCurrentImage();

// Filter and add axis for specific annotation type
const getTools = (type: AnnotationToolType) => {
  const toolStore = useAnnotationToolStore(type);
  return toolStore.finishedTools
    .filter((tool) => tool.imageID === currentImageID.value)
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
    ({ type, icon, details = MeasurementToolDetails }) => {
      const store = useAnnotationToolStore(type);
      const toolsWithAxis = getTools(type);
      return toolsWithAxis.map((tool) => ({
        id: tool.id,
        type,
        toolData: tool,
        icon,
        details,
        remove: () => store.removeTool(tool.id),
        jumpTo: () => store.jumpToTool(tool.id),
        toggleHidden: () => {
          const toggled = !store.toolByID[tool.id].hidden;
          store.updateTool(tool.id, { hidden: toggled });
        },
        updateTool: (patch: Partial<AnnotationTool>) => {
          store.updateTool(tool.id, patch);
        },
      }));
    }
  );
});

// --- selection and batch actions  --- //

const selectionStore = useToolSelectionStore();

const { selectAll, deselectAll, selected, selectionState } =
  useMultipleToolSelection(tools);

const toggleSelectAll = (shouldSelectAll: Maybe<boolean>) => {
  if (shouldSelectAll) {
    selectAll();
  } else {
    deselectAll();
  }
};

function removeAll() {
  selectionStore.selection.forEach((sel) => {
    const store = useAnnotationToolStore(sel.type);
    store.removeTool(sel.id);
  });
}

// If all selected tools are already hidden, it should be "show".
// If at least one selected tool is visible, it should be "hide".
const allHidden = computed(() => {
  return selected.value
    .map((id) => tools.value.find((tool) => id === tool.id))
    .filter(nonNullable)
    .every((tool) => tool.toolData.hidden);
});

const forEachSelectedTool = (
  callback: (tool: (typeof tools.value)[number]) => void
) =>
  tools.value
    .filter((tool) => selectionStore.isSelected(tool.id))
    .forEach(callback);

function toggleGlobalHidden() {
  const hidden = !allHidden.value;
  forEachSelectedTool((tool) => {
    tool.updateTool({ hidden });
  });
}
</script>

<template>
  <v-row no-gutters justify="space-between" align="center" class="mb-1">
    <v-col class="d-flex">
      <v-checkbox
        class="ml-3"
        :indeterminate="selectionState === MultipleSelectionState.Some"
        label="Select All"
        :model-value="selectionState === MultipleSelectionState.All"
        @update:model-value="toggleSelectAll"
        density="compact"
        hide-details
      />
    </v-col>

    <!-- Count of selected tools -->
    <v-col class="v-label">
      {{ selected.length }} of {{ tools.length }} selected
    </v-col>

    <v-col align-self="center" class="d-flex justify-end">
      <v-btn
        icon
        variant="text"
        :disabled="selectionState === MultipleSelectionState.None"
        @click.stop="toggleGlobalHidden"
      >
        <v-icon v-if="allHidden">mdi-eye-off</v-icon>
        <v-icon v-else>mdi-eye</v-icon>
        <v-tooltip location="top" activator="parent">{{
          allHidden ? 'Show' : 'Hide'
        }}</v-tooltip>
      </v-btn>
      <v-btn
        icon
        variant="text"
        :disabled="selectionState === MultipleSelectionState.None"
        @click.stop="removeAll"
      >
        <v-icon>mdi-delete</v-icon>
        <v-tooltip
          :disabled="selectionState === MultipleSelectionState.None"
          location="top"
          activator="parent"
        >
          Delete selected
        </v-tooltip>
      </v-btn>
    </v-col>
  </v-row>

  <v-list-item v-for="tool in tools" :key="tool.id">
    <v-container>
      <v-row class="d-flex align-center main-row">
        <v-checkbox
          class="no-grow mr-4"
          density="compact"
          hide-details
          :key="tool.id"
          :value="tool.id"
          v-model="selected"
          @click.stop
        />

        <v-icon class="tool-icon mr-4">{{ tool.icon }}</v-icon>

        <div
          class="color-dot flex-shrink-0 mr-2"
          :style="{ backgroundColor: tool.toolData.color }"
        />
        <v-list-item-title v-bind="$attrs">
          {{ tool.toolData.labelName }}
        </v-list-item-title>

        <span class="ml-auto flex-shrink-0">
          <v-btn icon variant="text" @click="tool.jumpTo()">
            <v-icon>mdi-target</v-icon>
            <v-tooltip location="top" activator="parent">
              Reveal Slice
            </v-tooltip>
          </v-btn>
          <v-btn icon variant="text" @click="tool.toggleHidden()">
            <v-icon v-if="tool.toolData.hidden">mdi-eye-off</v-icon>
            <v-icon v-else>mdi-eye</v-icon>
            <v-tooltip location="top" activator="parent">{{
              tool.toolData.hidden ? 'Show' : 'Hide'
            }}</v-tooltip>
          </v-btn>
          <v-btn icon variant="text" @click="tool.remove()">
            <v-icon>mdi-delete</v-icon>
            <v-tooltip location="top" activator="parent">Delete</v-tooltip>
          </v-btn>
        </span>
      </v-row>

      <v-row class="mt-4">
        <v-list-item-subtitle class="w-100">
          <component :is="tool.details" :tool="tool.toolData" />
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
}

.tool-icon {
  opacity: var(--v-medium-emphasis-opacity);
}

.no-grow {
  flex: 0 0 auto;
}
</style>
