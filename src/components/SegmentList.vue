<script setup lang="ts">
import { computed, ref } from 'vue';

import EditableChipList from '@/src/components/EditableChipList.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentGroupDialog from '@/src/components/SaveSegmentGroupDialog.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentEditing } from '@/src/composables/useSegmentEditing';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { Maybe } from '@/src/types';
import { type SegmentationDisplayPatch } from '@/src/types/segmentation';

const segmentationStore = useSegmentationStore();
const { segments } = useSegmentStore();
const { currentImageID } = useCurrentImage();

// Scoped to the viewed image: the per-image controls belong to this image's
// masks. Rendering creates nothing, so an image with no masks has no sliders.
const viewedSegmentation = computed(() => {
  const imageId = currentImageID.value;
  return imageId
    ? segmentationStore.getSegmentationForImage(imageId)
    : undefined;
});

// The registry is image-independent, and so is everything a row carries:
// visibility and lock describe the segment, not one image's mask of it.
const rows = computed(() =>
  segments.segmentList.value.map((segment) => {
    const appearance = segments.appearanceOf(segment.id);
    return {
      id: segment.id,
      name: appearance.name,
      color: appearance.cssColor,
      visible: appearance.visible,
      locked: appearance.locked,
    };
  })
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

// Saving writes this image's masks, so it stays offered and says why it
// cannot run rather than disappearing.
const savableReason = computed(() => {
  if (viewingCine.value) return 'A clip has no segmentation to save';
  if (!viewedSegmentation.value?.order.length)
    return 'Nothing is painted on this image yet';
  return '';
});

function openSaveDialog() {
  if (savableReason.value) return;
  saveDialog.value = true;
}

// --- selection --- //

const selectedSegmentOn = computed({
  get: () => segments.selectedSegmentId.value ?? null,
  set: (id: Maybe<string>) => segments.selectSegment(id ?? undefined),
});

// Adding a row allocates no storage and touches no image: the segment exists
// as identity until an edit binds a mask to it.
function addNewSegment() {
  if (viewingCine.value) return;
  segments.addSegment();
}

// --- row actions --- //

const toggleVisible = (id: string) =>
  segments.updateSegment(id, { visible: !segments.appearanceOf(id).visible });

const toggleLock = (id: string) =>
  segments.updateSegment(id, { locked: !segments.appearanceOf(id).locked });

// Locking is the whole opt-in for overlap, and nothing else on screen says so.
const lockTooltip = (locked: boolean) =>
  locked
    ? 'Unlock. Painting over this segment takes its voxels.'
    : 'Lock. Painting over this segment shares its voxels instead of taking them.';

const allVisible = computed(() =>
  rows.value.every((segment) => segment.visible)
);

const allLocked = computed(() => rows.value.every((segment) => segment.locked));

function toggleGlobalVisible() {
  const visible = !allVisible.value;
  rows.value.forEach((segment) =>
    segments.updateSegment(segment.id, { visible })
  );
}

function toggleGlobalLocked() {
  const locked = !allLocked.value;
  rows.value.forEach((segment) =>
    segments.updateSegment(segment.id, { locked })
  );
}

function deleteMask(id: string) {
  segments.deleteSegment(id);
}

// --- editing state --- //

const editing = useSegmentEditing(() => segments);
const { editDialog, editState, editingSegment, editingName, invalidNames } =
  editing;
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
        data-testid="save-segments-button"
        icon="mdi-content-save"
        class="my-1"
        :disabled="!!savableReason"
        @click.stop="openSaveDialog"
      >
        <v-tooltip location="top" activator="parent">{{
          savableReason || 'Save'
        }}</v-tooltip>
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
      v-model="selectedSegmentOn"
      :items="rows"
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
          <div class="color-dot" :style="{ background: item.color }" />
        </div>
      </template>
      <template #item-append="{ item }">
        <!-- Lock/unlock the segment, which holds on every image -->
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
            lockTooltip(item.locked)
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
          @click.stop="editing.startEditing(item.id)"
          :disabled="item.locked"
        />
        <!-- Delete segment button (disabled when locked) -->
        <v-btn
          icon="mdi-delete"
          size="small"
          density="compact"
          class="ml-auto"
          variant="plain"
          @click.stop="deleteMask(item.id)"
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
      :original="editingName"
      v-model:color="editState.color"
      v-model:fill-opacity="editState.fillOpacity"
      v-model:outline-opacity="editState.outlineOpacity"
      v-model:stroke-width="editState.strokeWidth"
      @delete="editing.deleteEditingSegment()"
      @cancel="editing.stopEditing(false)"
      @done="editing.stopEditing(true)"
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
.color-dot {
  width: 18px;
  height: 18px;
  border-radius: 16px;
  border: 1px solid #111;
}
.dot-container {
  width: 18px;
}
</style>
