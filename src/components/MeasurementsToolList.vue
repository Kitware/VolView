<script setup lang="ts">
import { computed } from 'vue';
import { useSegmentShapes } from '@/src/segmentation/composables/useSegmentShapes';
import { removeSelectedTools } from '@/src/store/tools';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import SegmentAssignmentList from '@/src/segmentation/components/SegmentAssignmentList.vue';

const { shapes } = useSegmentShapes();
const registry = useSegmentStore().segments;
const selection = useToolSelectionStore();

const rows = computed(() =>
  shapes.value.map((shape) => ({
    ...shape,
    appearance: registry.appearanceOf(shape.segmentId),
  }))
);

const selectedRows = computed(() =>
  rows.value.filter((shape) => selection.isSelected(shape.id))
);
const selectedAll = computed(
  () => !!rows.value.length && selectedRows.value.length === rows.value.length
);
const selectedSome = computed(() => !!selectedRows.value.length);
const allSelectedHidden = computed(
  () => selectedSome.value && selectedRows.value.every((shape) => shape.hidden)
);

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
  selectedRows.value.forEach((shape) => shape.setHidden(hidden));
}
</script>

<template>
  <v-list density="compact" bg-color="transparent" class="py-0">
    <v-list-item v-if="!rows.length">
      <v-list-item-title class="text-body-2 text-medium-emphasis">
        No rectangles, polygons, or rulers yet.
      </v-list-item-title>
    </v-list-item>
    <div v-else class="d-flex align-center px-2 mb-1">
      <v-checkbox-btn
        class="no-grow"
        :model-value="selectedAll"
        :indeterminate="selectedSome && !selectedAll"
        aria-label="Select all measurements"
        @click="toggleSelectAll"
      />
      <span class="text-caption text-medium-emphasis ml-1">
        {{ selectedRows.length }} of {{ rows.length }} selected
      </span>
      <span class="ml-auto flex-shrink-0 d-flex align-center ga-1">
        <v-btn
          icon
          size="small"
          density="compact"
          variant="plain"
          :disabled="!selectedSome"
          :aria-label="allSelectedHidden ? 'Show selected' : 'Hide selected'"
          @click="toggleSelectedHidden"
        >
          <v-icon>{{ allSelectedHidden ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
          <v-tooltip location="top" activator="parent">
            {{
              selectedSome
                ? allSelectedHidden
                  ? 'Show selected'
                  : 'Hide selected'
                : 'Select measurements to show or hide'
            }}
          </v-tooltip>
        </v-btn>
        <v-btn
          icon
          size="small"
          density="compact"
          variant="plain"
          :disabled="!selectedSome"
          aria-label="Delete selected"
          @click="removeSelectedTools"
        >
          <v-icon>mdi-delete</v-icon>
          <v-tooltip location="top" activator="parent">
            {{
              selectedSome ? 'Delete selected' : 'Select measurements to delete'
            }}
          </v-tooltip>
        </v-btn>
      </span>
    </div>
    <v-list-item
      v-for="shape in rows"
      :key="shape.id"
      data-testid="segment-shape-row"
      class="shape-row px-2"
    >
      <div class="d-flex align-center flex-nowrap">
        <v-checkbox-btn
          class="no-grow mr-1"
          :model-value="selection.isSelected(shape.id)"
          :aria-label="`Select ${shape.appearance.name}: ${shape.placement}`"
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
              :aria-label="`Change segment for ${shape.appearance.name}: ${shape.placement}`"
            >
              <span
                class="color-dot"
                :style="{ backgroundColor: shape.appearance.cssColor }"
              />
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
        <div class="measurement-identity min-width-0">
          <v-list-item-title>{{ shape.appearance.name }}</v-list-item-title>
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
            :aria-label="`${shape.frame != null ? 'Reveal frame' : 'Reveal slice'} for ${shape.appearance.name}: ${shape.placement}`"
            @click.stop="shape.jumpTo()"
          >
            <v-icon>mdi-target</v-icon>
            <v-tooltip location="left" activator="parent">
              {{ shape.frame != null ? 'Reveal Frame' : 'Reveal Slice' }}
            </v-tooltip>
          </v-btn>
          <v-menu location="bottom end" :max-height="320">
            <template #activator="{ props: activator }">
              <v-btn
                v-bind="activator"
                icon
                size="small"
                density="compact"
                variant="plain"
                :aria-label="`Change segment for ${shape.appearance.name}: ${shape.placement}`"
                @click.stop
              >
                <v-icon>mdi-pencil</v-icon>
                <v-tooltip location="left" activator="parent">
                  Change segment
                </v-tooltip>
              </v-btn>
            </template>
            <segment-assignment-list
              :segment-id="shape.segmentId"
              @select="shape.assignSegment($event)"
            />
          </v-menu>
          <v-btn
            icon
            size="small"
            density="compact"
            variant="plain"
            :aria-label="`${shape.hidden ? 'Show' : 'Hide'} ${shape.appearance.name}: ${shape.placement}`"
            @click.stop="shape.toggleHidden()"
          >
            <v-icon>{{ shape.hidden ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
            <v-tooltip location="left" activator="parent">{{
              shape.hidden ? 'Show' : 'Hide'
            }}</v-tooltip>
          </v-btn>
          <v-btn
            icon
            size="small"
            density="compact"
            variant="plain"
            data-testid="delete-shape-button"
            :aria-label="`Delete ${shape.appearance.name}: ${shape.placement}`"
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

.color-dot {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #111;
}

.segment-picker-button {
  opacity: 1;
}

.min-width-0 {
  min-width: 0;
}

.measurement-identity {
  flex: 1 1 auto;
}

.no-grow {
  flex: 0 0 auto;
}
</style>
