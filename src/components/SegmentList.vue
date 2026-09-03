<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import ColorDot from '@/src/components/ColorDot.vue';
import EditableChipList from '@/src/components/EditableChipList.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentGroupDialog from '@/src/components/SaveSegmentGroupDialog.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { useSegmentationStore } from '@/src/store/segmentations';
import { Maybe } from '@/src/types';
import {
  cssColorToRGBA,
  listSegments,
  rgbaToCssColor,
  type SegmentationDisplayPatch,
} from '@/src/types/segmentation';

const segmentationStore = useSegmentationStore();
const { currentImageID } = useCurrentImage();

// Scoped to the viewed image, never to the active segment's image: after an
// image switch the panel must show this image's segments, not the last edited
// one's. Rendering creates nothing, so an image with no segmentation is empty.
const viewedSegmentation = computed(() => {
  const imageId = currentImageID.value;
  return imageId
    ? segmentationStore.getSegmentationForImage(imageId)
    : undefined;
});

const segments = computed(() =>
  viewedSegmentation.value ? listSegments(viewedSegmentation.value) : []
);

// A clip is a stack of unrelated frames, so a segmentation drawn across it
// means nothing and saves as an empty 2D file.
const viewingCine = computed(() => isCineImage(currentImageID.value));

// --- display --- //

// One multiplier each for fill and outline, scaling every segment of the
// viewed image at once, plus the thickness they share.
const DISPLAY_CONTROLS = [
  { key: 'fillOpacity', label: 'Fill Opacity', max: 1, step: 0.01 },
  { key: 'outlineOpacity', label: 'Outline Opacity', max: 1, step: 0.01 },
  { key: 'outlineThickness', label: 'Outline Thickness', max: 10, step: 1 },
] as const;

const setDisplay = (patch: SegmentationDisplayPatch) => {
  const segmentation = viewedSegmentation.value;
  if (!segmentation) return;
  segmentationStore.updateSegmentationDisplay(segmentation.id, patch);
};

// --- saving --- //

const saveDialog = ref(false);

function openSaveDialog() {
  saveDialog.value = true;
}

const segmentById = (id: string) =>
  segments.value.find((segment) => segment.id === id);

// --- selection --- //

const selectedSegment = computed({
  get: () => {
    const id = segmentationStore.activeSegmentId;
    return id && segmentById(id) ? id : null;
  },
  set: (id: Maybe<string>) => {
    if (!id) {
      segmentationStore.clearActiveSegment();
      return;
    }
    segmentationStore.setActiveSegment(id);
  },
});

// Adding a row allocates no storage: the segment exists as identity until an
// edit binds a labelmap to it.
function addNewSegment() {
  const imageId = currentImageID.value;
  if (!imageId || viewingCine.value) return;
  const segmentation = segmentationStore.ensureSegmentationForImage(imageId);
  const segment = segmentationStore.createSegment(segmentation.id);
  segmentationStore.setActiveSegment(segment.id);
}

// --- row actions --- //

const toggleVisible = (id: string) => {
  const segment = segmentById(id);
  if (!segment) return;
  segmentationStore.updateSegment(id, { visible: !segment.visible });
};

const toggleLock = (id: string) => {
  const segment = segmentById(id);
  if (!segment) return;
  segmentationStore.updateSegment(id, { locked: !segment.locked });
};

const allVisible = computed(() =>
  segments.value.every((segment) => segment.visible)
);

const allLocked = computed(() =>
  segments.value.every((segment) => segment.locked)
);

function toggleGlobalVisible() {
  const visible = !allVisible.value;
  segments.value.forEach((segment) =>
    segmentationStore.updateSegment(segment.id, { visible })
  );
}

function toggleGlobalLocked() {
  const locked = !allLocked.value;
  segments.value.forEach((segment) =>
    segmentationStore.updateSegment(segment.id, { locked })
  );
}

function deleteSegment(id: string) {
  if (!segmentById(id)) return;
  segmentationStore.deleteSegment(id);
}

// --- editing state --- //

const editingSegmentId = ref<Maybe<string>>(null);
const editState = reactive({
  name: '',
  color: '',
  fillOpacity: 1,
  outlineOpacity: 1,
});
const editDialog = ref(false);

const editingSegment = computed(() =>
  editingSegmentId.value ? segmentById(editingSegmentId.value) : undefined
);

const invalidNames = computed(() => {
  const names = new Set(
    segments.value
      .filter((segment) => segment.id !== editingSegmentId.value)
      .map((segment) => segment.name)
  );
  return names;
});

function startEditing(id: string) {
  const segment = segmentById(id);
  if (!segment) return;
  editingSegmentId.value = id;
  editDialog.value = true;
  editState.name = segment.name;
  editState.color = rgbaToCssColor(segment.color);
  editState.fillOpacity = segment.fillOpacity;
  editState.outlineOpacity = segment.outlineOpacity;
}

function stopEditing(commit: boolean) {
  const id = editingSegmentId.value;
  if (id && commit && segmentById(id)) {
    segmentationStore.updateSegment(id, {
      name: editState.name,
      color: cssColorToRGBA(editState.color),
      fillOpacity: editState.fillOpacity,
      outlineOpacity: editState.outlineOpacity,
    });
  }
  editingSegmentId.value = null;
  editDialog.value = false;
}

function deleteEditingSegment() {
  if (editingSegmentId.value) deleteSegment(editingSegmentId.value);
  stopEditing(false);
}
</script>

<template>
  <div v-if="currentImageID" class="px-3" data-testid="segment-list">
    <div class="d-flex justify-start ga-4">
      <v-btn @click.stop="toggleGlobalVisible" class="my-1">
        <template #prepend>
          <v-icon v-if="allVisible">mdi-eye</v-icon>
          <v-icon v-else>mdi-eye-off</v-icon>
        </template>
        Toggle Segments
        <v-tooltip location="top" activator="parent">{{
          allVisible ? 'Hide' : 'Show'
        }}</v-tooltip>
      </v-btn>

      <v-btn @click.stop="toggleGlobalLocked" class="my-1">
        <template #prepend>
          <v-icon v-if="allLocked" color="red">mdi-lock</v-icon>
          <v-icon v-else>mdi-lock-open</v-icon>
        </template>
        Toggle Locks
        <v-tooltip location="top" activator="parent">{{
          allLocked ? 'Unlock All' : 'Lock All'
        }}</v-tooltip>
      </v-btn>

      <v-btn
        v-if="viewedSegmentation"
        data-testid="save-segments-button"
        icon="mdi-content-save"
        class="my-1"
        @click.stop="openSaveDialog"
      >
        <v-tooltip location="top" activator="parent">Save</v-tooltip>
      </v-btn>
    </div>

    <div v-if="viewedSegmentation" class="my-2">
      <v-slider
        v-for="control in DISPLAY_CONTROLS"
        :key="control.key"
        class="mx-4"
        :label="control.label"
        min="0"
        :max="control.max"
        :step="control.step"
        density="compact"
        hide-details
        thumb-label
        :model-value="viewedSegmentation[control.key]"
        @update:model-value="setDisplay({ [control.key]: $event })"
      />
    </div>

    <editable-chip-list
      v-model="selectedSegment"
      :items="segments"
      item-key="id"
      item-title="name"
      create-label-text="New segment"
      :hide-create="viewingCine"
      @create="addNewSegment"
      class="my-4"
    >
      <template #item-prepend="{ item }">
        <!-- dot container keeps overflowing name from squishing dot width  -->
        <div class="dot-container mr-3">
          <ColorDot :color="item.color" />
        </div>
      </template>
      <template #item-append="{ item }">
        <!-- Lock/unlock segment button -->
        <v-btn
          icon
          size="small"
          density="compact"
          class="mr-1"
          variant="plain"
          @click.stop="toggleLock(item.id)"
          :color="item.locked ? 'error' : undefined"
        >
          <v-icon>{{ item.locked ? 'mdi-lock' : 'mdi-lock-open' }}</v-icon>
          <v-tooltip location="left" activator="parent">{{
            item.locked ? 'Unlock' : 'Lock'
          }}</v-tooltip>
        </v-btn>
        <v-btn
          icon
          size="small"
          density="compact"
          class="ml-auto mr-1"
          variant="plain"
          @click.stop="toggleVisible(item.id)"
        >
          <v-icon v-if="item.visible" style="pointer-events: none"
            >mdi-eye</v-icon
          >
          <v-icon v-else style="pointer-events: none">mdi-eye-off</v-icon>
          <v-tooltip location="left" activator="parent">{{
            item.visible ? 'Hide' : 'Show'
          }}</v-tooltip>
        </v-btn>
        <!-- Edit segment button (disabled when locked) -->
        <v-btn
          icon="mdi-pencil"
          size="small"
          density="compact"
          class="mr-1"
          variant="plain"
          @click.stop="startEditing(item.id)"
          :disabled="item.locked"
        />
        <!-- Delete segment button (disabled when locked) -->
        <v-btn
          icon="mdi-delete"
          size="small"
          density="compact"
          class="ml-auto"
          variant="plain"
          @click.stop="deleteSegment(item.id)"
          :disabled="item.locked"
        />
      </template>
    </editable-chip-list>
  </div>
  <div v-else class="px-3 py-2 text-center text-caption">No selected image</div>

  <isolated-dialog v-model="editDialog" @keydown.stop max-width="800px">
    <segment-editor
      v-if="!!editingSegment"
      v-model:name="editState.name"
      v-model:color="editState.color"
      v-model:fillOpacity="editState.fillOpacity"
      v-model:outlineOpacity="editState.outlineOpacity"
      @delete="deleteEditingSegment"
      @cancel="stopEditing(false)"
      @done="stopEditing(true)"
      :invalidNames="invalidNames"
    />
  </isolated-dialog>

  <closeable-dialog v-model="saveDialog" max-width="30%">
    <template v-slot="{ close }">
      <!-- The overlay keeps its content once opened, so the dialog is mounted
           per open to read the segmentation as it stands now. -->
      <save-segment-group-dialog
        v-if="saveDialog && viewedSegmentation"
        :id="viewedSegmentation.id"
        @done="close"
      />
    </template>
  </closeable-dialog>
</template>

<style scoped>
.dot-container {
  width: 18px;
}
</style>
