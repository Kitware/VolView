<script setup lang="ts">
import { computed, ref } from 'vue';

import EditableItemList from '@/src/components/EditableItemList.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentGroupDialog from '@/src/components/SaveSegmentGroupDialog.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentEditing } from '@/src/composables/useSegmentEditing';
import { revealSegmentContent } from '@/src/core/annotations/locator';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME } from '@/src/constants';
import { useSegmentShapes } from '@/src/composables/useSegmentShapes';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { Maybe } from '@/src/types';
import type { LPSAxis } from '@/src/types/lps';
import {
  isEmptyExtent,
  markedExtent,
  type SegmentationDisplayPatch,
} from '@/src/types/segmentation';

const registry = useSegmentStore().segments;
const { shapesOf } = useSegmentShapes();
const segmentationStore = useSegmentationStore();
const { currentImageID } = useCurrentImage();

// Scoped to the viewed image: the per-image controls belong to this image's
// masks. Rendering creates nothing, so an image with no masks has no sliders.
const viewedSegmentation = computed(() => {
  const imageId = currentImageID.value;
  return imageId
    ? segmentationStore.getSegmentationForImage(imageId)
    : undefined;
});

/** The viewed image's mask for a segment, once it has storage behind it. */
const boundMask = (segmentId: string) => {
  const mask = segmentationStore.maskFor(currentImageID.value, segmentId);
  const binding = mask && segmentationStore.maskVoxels(mask.id).binding();
  return binding && !isEmptyExtent(binding.extent) ? mask : undefined;
};

// The registry is image-independent, and so is everything a row carries except
// its bounds: visibility and lock describe the segment, not one image's mask.
const rows = computed(() =>
  registry.segmentList.value.map((segment) => {
    const appearance = registry.appearanceOf(segment.id);
    return {
      id: segment.id,
      name: appearance.name || NO_NAME,
      color: appearance.cssColor,
      visible: appearance.visible,
      locked: appearance.locked,
      maskId: boundMask(segment.id)?.id,
      shapes: shapesOf(segment.id),
    };
  })
);

type Row = (typeof rows.value)[number];

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
  get: () => registry.selectedSegmentId.value ?? null,
  set: (id: Maybe<string>) => registry.selectSegment(id ?? undefined),
});

// Adding a row allocates no storage and touches no image: the segment exists
// as identity until an edit binds a mask to it.
function addNewSegment() {
  if (viewingCine.value) return;
  registry.addSegment();
}

// --- row actions --- //

const update = (id: string, patch: { visible?: boolean; locked?: boolean }) =>
  registry.updateSegment(id, patch);

const toggleVisible = (id: string) =>
  update(id, { visible: !registry.appearanceOf(id).visible });

const toggleLock = (id: string) =>
  update(id, { locked: !registry.appearanceOf(id).locked });

// Locking is the whole opt-in for overlap, and nothing else on screen says so.
const lockTooltip = (locked: boolean) =>
  locked
    ? 'Unlock. Painting over this segment takes its voxels.'
    : 'Lock. Painting over this segment shares its voxels instead of taking them.';

// The list offers every segment on every image, so a row with nothing on this
// one is the common case rather than the exception.
const revealReason = (row: Row) =>
  row.maskId || row.shapes.length
    ? ''
    : 'This segment has nothing on this image';

// Scanned rather than read off the binding: the binding's extent is the
// allocation, padded on growth and never shrunk by an erase, so its middle can
// sit slices away from anything painted. One scan per click, nothing cached.
function paintedExtent(maskId: Maybe<string>) {
  if (!maskId) return undefined;
  const voxels = segmentationStore.maskVoxels(maskId);
  const binding = voxels.binding();
  if (!binding) return undefined;
  const bounds = markedExtent(
    voxels.scalars(),
    binding.extent,
    binding.labelValue
  );
  return isEmptyExtent(bounds) ? undefined : bounds;
}

// Paint and shapes are one segment, so both steer the jump: a view lands on the
// middle of everything the segment holds along that view's axis.
function revealSlice(row: Row) {
  const imageId = currentImageID.value;
  if (!imageId) return;
  const slicesByAxis = row.shapes.reduce<Partial<Record<LPSAxis, number[]>>>(
    (byAxis, shape) => {
      const axis = shape.axis as LPSAxis;
      return { ...byAxis, [axis]: [...(byAxis[axis] ?? []), shape.slice] };
    },
    {}
  );
  revealSegmentContent(imageId, {
    extent: paintedExtent(row.maskId),
    slicesByAxis,
  });
}

const allVisible = computed(() =>
  rows.value.every((segment) => segment.visible)
);

const allLocked = computed(() => rows.value.every((segment) => segment.locked));

function toggleGlobalVisible() {
  const visible = !allVisible.value;
  rows.value.forEach((segment) => update(segment.id, { visible }));
}

function toggleGlobalLocked() {
  const locked = !allLocked.value;
  rows.value.forEach((segment) => update(segment.id, { locked }));
}

function deleteSegment(id: string) {
  registry.deleteSegment(id);
}

// --- editing state --- //

const editing = useSegmentEditing(() => registry);
const { editDialog, editState, editingSegment, editingName, invalidNames } =
  editing;
</script>

<template>
  <div v-if="currentImageID" class="px-2" data-testid="segment-list">
    <div class="d-flex align-center ga-1 pt-1">
      <span class="text-subtitle-2 text-medium-emphasis">Segments</span>
      <v-spacer />
      <v-btn
        data-testid="toggle-segments-visible-button"
        icon
        size="small"
        density="comfortable"
        variant="text"
        @click.stop="toggleGlobalVisible"
      >
        <v-icon>{{ allVisible ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
        <v-tooltip location="top" activator="parent">{{
          allVisible ? 'Hide every segment' : 'Show every segment'
        }}</v-tooltip>
      </v-btn>

      <v-btn
        data-testid="toggle-segments-locked-button"
        icon
        size="small"
        density="comfortable"
        variant="text"
        :color="allLocked ? 'error' : undefined"
        @click.stop="toggleGlobalLocked"
      >
        <v-icon>{{ allLocked ? 'mdi-lock' : 'mdi-lock-open' }}</v-icon>
        <v-tooltip location="top" activator="parent">{{
          allLocked ? 'Unlock every segment' : 'Lock every segment'
        }}</v-tooltip>
      </v-btn>

      <v-btn
        data-testid="save-segments-button"
        icon
        size="small"
        density="comfortable"
        variant="text"
        :disabled="!!savableReason"
        @click.stop="openSaveDialog"
      >
        <v-icon>mdi-content-save</v-icon>
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

    <editable-item-list
      v-model="selectedSegmentOn"
      :items="rows"
      item-key="id"
      item-title="name"
      create-text="New segment"
      :hide-create="viewingCine"
      :expandable="(row: Row) => row.shapes.length > 0"
      @create="addNewSegment"
      class="mb-2"
    >
      <template #item-expansion="{ item }">
        <div
          v-for="shape in item.shapes"
          :key="shape.id"
          class="d-flex align-center flex-nowrap shape-row"
          data-testid="segment-shape-row"
        >
          <v-icon class="shape-icon mr-2" size="small">{{ shape.icon }}</v-icon>
          <span class="text-caption text-truncate">{{ shape.placement }}</span>
          <span v-if="shape.measurement" class="text-caption ml-2">{{
            shape.measurement
          }}</span>
          <span class="ml-auto flex-shrink-0 d-flex align-center">
            <v-btn
              icon
              size="small"
              density="compact"
              class="mr-1"
              variant="plain"
              data-testid="reveal-shape-button"
              @click.stop="shape.jumpTo()"
            >
              <v-icon>mdi-target</v-icon>
              <v-tooltip location="left" activator="parent">
                Reveal Slice
              </v-tooltip>
            </v-btn>
            <v-btn
              icon
              size="small"
              density="compact"
              class="mr-1"
              variant="plain"
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
              @click.stop="shape.remove()"
            >
              <v-icon>mdi-delete</v-icon>
              <v-tooltip location="left" activator="parent">Delete</v-tooltip>
            </v-btn>
          </span>
        </div>
      </template>
      <template #item-prepend="{ item }">
        <!-- dot container keeps overflowing name from squishing dot width  -->
        <div class="dot-container mr-3">
          <button
            type="button"
            class="color-dot"
            data-testid="segment-color-button"
            :style="{ background: item.color }"
            @click.stop="editing.startEditing(item.id)"
          >
            <v-tooltip location="right" activator="parent">
              Change color
            </v-tooltip>
          </button>
        </div>
      </template>
      <template #item-append="{ item }">
        <!-- Slice only: the 2D views land on the middle of what is stored here -->
        <v-btn
          icon
          size="small"
          density="compact"
          class="mr-1"
          variant="plain"
          data-testid="reveal-segment-button"
          :disabled="!!revealReason(item)"
          @click.stop="revealSlice(item)"
        >
          <v-icon>mdi-target</v-icon>
          <v-tooltip location="left" activator="parent">{{
            revealReason(item) || 'Reveal Slice'
          }}</v-tooltip>
        </v-btn>
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
          class="mr-1"
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
        <!-- Edit button (disabled when locked) -->
        <v-btn
          icon="mdi-pencil"
          size="small"
          density="compact"
          class="mr-1"
          variant="plain"
          data-testid="edit-segment-button"
          @click.stop="editing.startEditing(item.id)"
          :disabled="item.locked"
        />
        <!-- Delete button (disabled when locked) -->
        <v-btn
          icon="mdi-delete"
          size="small"
          density="compact"
          variant="plain"
          @click.stop="deleteSegment(item.id)"
          :disabled="item.locked"
        />
      </template>
    </editable-item-list>
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
  padding: 0;
  cursor: pointer;
}
.dot-container {
  width: 18px;
}
.shape-row {
  padding: 2px 8px 2px 0;
}
.shape-icon {
  opacity: var(--v-medium-emphasis-opacity);
}
</style>
