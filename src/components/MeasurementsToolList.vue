<script setup lang="ts">
import { computed } from 'vue';
import { useSegmentShapes } from '@/src/segmentation/composables/useSegmentShapes';
import { removeSelectedTools } from '@/src/store/tools';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import SegmentAssignmentList from '@/src/segmentation/components/SegmentAssignmentList.vue';
import ColorDot from '@/src/components/ColorDot.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { NO_NAME } from '@/src/constants';

const { shapes } = useSegmentShapes();
const registry = useSegmentStore().segments;
const selection = useToolSelectionStore();

const rows = computed(() =>
  shapes.value.map((shape) => {
    const appearance = registry.appearanceOf(shape.segmentId);
    const name = appearance.name || NO_NAME;
    return {
      ...shape,
      appearance,
      name,
      // A hidden segment hides its shapes whatever their own flag says.
      drawn: !shape.hidden && appearance.visible,
      visibilityReason: appearance.visible
        ? ''
        : `Show segment ${name} to show or hide this measurement`,
    };
  })
);

const selectedRows = computed(() =>
  rows.value.filter((shape) => selection.isSelected(shape.id))
);
const selectedAll = computed(
  () => !!rows.value.length && selectedRows.value.length === rows.value.length
);
const selectedSome = computed(() => !!selectedRows.value.length);
const selectedToggleable = computed(() =>
  selectedRows.value.filter((shape) => !shape.visibilityReason)
);
const allSelectedHidden = computed(
  () =>
    !!selectedToggleable.value.length &&
    selectedToggleable.value.every((shape) => shape.hidden)
);
const noMeasurementsReason = computed(() =>
  rows.value.length ? '' : 'No measurements yet'
);
const selectedDeleteReason = computed(
  () =>
    noMeasurementsReason.value ||
    (selectedSome.value ? '' : 'Select measurements to delete')
);
const selectedVisibilityReason = computed(() => {
  if (noMeasurementsReason.value) return noMeasurementsReason.value;
  if (!selectedSome.value) return 'Select measurements to show or hide';
  if (!selectedToggleable.value.length)
    return 'Show the segments of the selected measurements first';
  return '';
});

function toggleSelected(shape: (typeof rows.value)[number]) {
  selection.toggleSelection(shape.id, shape.type);
}

function toggleSelectAll() {
  if (selectedAll.value) {
    rows.value.forEach((shape) => selection.removeSelection(shape.id));
  } else {
    rows.value.forEach((shape) => selection.addSelection(shape.id, shape.type));
  }
}

function toggleSelectedHidden() {
  const hidden = !allSelectedHidden.value;
  selectedToggleable.value.forEach((shape) => shape.setHidden(hidden));
}
</script>

<template>
  <v-list density="compact" bg-color="transparent" class="py-0">
    <div class="d-flex align-center px-2 mb-1">
      <reasoned-action :reason="noMeasurementsReason" v-slot="{ disabled }">
        <v-checkbox-btn
          class="flex-0-0"
          :model-value="selectedAll"
          :indeterminate="selectedSome && !selectedAll"
          :disabled="disabled"
          aria-label="Select all measurements"
          @click="toggleSelectAll"
        />
      </reasoned-action>
      <span class="text-caption text-medium-emphasis ml-1">
        {{ selectedRows.length }} of {{ rows.length }} selected
      </span>
      <span class="ml-auto flex-shrink-0 d-flex align-center ga-1">
        <reasoned-action
          :reason="selectedVisibilityReason"
          :tooltip="allSelectedHidden ? 'Show selected' : 'Hide selected'"
          v-slot="{ disabled }"
        >
          <v-btn
            icon
            size="small"
            density="compact"
            variant="plain"
            :disabled="disabled"
            :aria-label="allSelectedHidden ? 'Show selected' : 'Hide selected'"
            @click="toggleSelectedHidden"
          >
            <v-icon>{{ allSelectedHidden ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
          </v-btn>
        </reasoned-action>
        <reasoned-action
          :reason="selectedDeleteReason"
          tooltip="Delete selected"
          v-slot="{ disabled }"
        >
          <v-btn
            icon
            size="small"
            density="compact"
            variant="plain"
            :disabled="disabled"
            aria-label="Delete selected"
            @click="removeSelectedTools"
          >
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </reasoned-action>
      </span>
    </div>
    <v-list-item v-if="!rows.length">
      <v-list-item-title class="text-body-2 text-medium-emphasis">
        No rectangles, polygons, or rulers yet.
      </v-list-item-title>
    </v-list-item>
    <v-list-item
      v-for="shape in rows"
      :key="shape.id"
      data-testid="segment-shape-row"
      class="px-2"
    >
      <div class="d-flex align-center flex-nowrap">
        <v-checkbox-btn
          class="flex-0-0 mr-1"
          :model-value="selection.isSelected(shape.id)"
          :aria-label="`Select ${shape.name}: ${shape.placement}`"
          @click.stop="toggleSelected(shape)"
        />
        <v-icon class="shape-icon mr-2">{{ shape.icon }}</v-icon>
        <v-menu location="bottom start" :max-height="320">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              icon
              size="small"
              density="compact"
              variant="plain"
              class="segment-picker-button mr-1"
              :aria-label="`Change segment for ${shape.name}: ${shape.placement}`"
            >
              <color-dot :color="shape.appearance.cssColor" />
              <v-tooltip location="top" activator="parent">
                Change segment
              </v-tooltip>
            </v-btn>
          </template>
          <segment-assignment-list
            :segment-id="shape.segmentId"
            @select="shape.assignSegment($event)"
          />
        </v-menu>
        <div class="flex-1-1 min-width-0">
          <v-list-item-title>{{ shape.name }}</v-list-item-title>
          <v-list-item-subtitle>
            {{ shape.placement }}
            <span v-if="shape.measurement" class="ml-1">{{
              shape.measurement
            }}</span>
          </v-list-item-subtitle>
        </div>
        <span class="ml-auto flex-shrink-0 d-flex align-center ga-1">
          <v-btn
            icon
            size="small"
            density="compact"
            variant="plain"
            data-testid="reveal-shape-button"
            :aria-label="`${shape.frame != null ? 'Reveal frame' : 'Reveal slice'} for ${shape.name}: ${shape.placement}`"
            @click.stop="shape.jumpTo()"
          >
            <v-icon>mdi-target</v-icon>
            <v-tooltip location="left" activator="parent">
              {{ shape.frame != null ? 'Reveal Frame' : 'Reveal Slice' }}
            </v-tooltip>
          </v-btn>
          <reasoned-action
            :reason="shape.visibilityReason"
            :tooltip="shape.hidden ? 'Show' : 'Hide'"
            v-slot="{ disabled }"
          >
            <v-btn
              icon
              size="small"
              density="compact"
              variant="plain"
              :disabled="disabled"
              :aria-label="`${shape.hidden ? 'Show' : 'Hide'} ${shape.name}: ${shape.placement}`"
              @click.stop="shape.toggleHidden()"
            >
              <v-icon>{{ shape.drawn ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
            </v-btn>
          </reasoned-action>
          <v-btn
            icon
            size="small"
            density="compact"
            variant="plain"
            data-testid="delete-shape-button"
            :aria-label="`Delete ${shape.name}: ${shape.placement}`"
            @click.stop="shape.remove()"
          >
            <v-icon>mdi-delete</v-icon>
            <v-tooltip location="left" activator="parent">Delete</v-tooltip>
          </v-btn>
        </span>
      </div>
    </v-list-item>
  </v-list>
</template>

<style scoped>
.shape-icon {
  opacity: var(--v-medium-emphasis-opacity);
}

.segment-picker-button {
  opacity: 1;
}

.min-width-0 {
  min-width: 0;
}
</style>
