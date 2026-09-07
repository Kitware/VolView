<script setup lang="ts">
import { computed, ref } from 'vue';

import EditableItemList from '@/src/components/EditableItemList.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentGroupDialog from '@/src/components/SaveSegmentGroupDialog.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentEditing } from '@/src/composables/useSegmentEditing';
import { revealExtent } from '@/src/core/annotations/locator';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME } from '@/src/constants';
import { useSegmentationStore } from '@/src/store/segmentations';
import type { SegmentRegistry } from '@/src/store/tools/segmentRegistry';
import { Maybe } from '@/src/types';
import {
  isEmptyExtent,
  markedExtent,
  type SegmentationDisplayPatch,
} from '@/src/types/segmentation';

const props = defineProps<{
  registry: SegmentRegistry;
  /** Singular noun for the create affordance and the list's testid. */
  noun: string;
  /**
   * Whether the registry's entries are painted into image masks. Every control
   * beyond name, color, edit and delete follows from that: the eye drives the
   * labelmap renderer, lock is the overlap opt-in for voxels, Reveal Slice and
   * the display sliders read the viewed image's mask, and save writes it. A
   * ruler is rendered from none of them.
   */
  masked?: boolean;
}>();

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
  props.registry.segmentList.value.map((segment) => {
    const appearance = props.registry.appearanceOf(segment.id);
    return {
      id: segment.id,
      name: appearance.name || NO_NAME,
      color: appearance.cssColor,
      visible: appearance.visible,
      locked: appearance.locked,
      maskId: props.masked ? boundMask(segment.id)?.id : undefined,
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
  get: () => props.registry.selectedSegmentId.value ?? null,
  set: (id: Maybe<string>) => props.registry.selectSegment(id ?? undefined),
});

// Adding a row allocates no storage and touches no image: the segment exists
// as identity until an edit binds a mask to it.
function addNewSegment() {
  if (props.masked && viewingCine.value) return;
  props.registry.addSegment();
}

// --- row actions --- //

const update = (id: string, patch: { visible?: boolean; locked?: boolean }) =>
  props.registry.updateSegment(id, patch);

const toggleVisible = (id: string) =>
  update(id, { visible: !props.registry.appearanceOf(id).visible });

const toggleLock = (id: string) =>
  update(id, { locked: !props.registry.appearanceOf(id).locked });

// Locking is the whole opt-in for overlap, and nothing else on screen says so.
const lockTooltip = (locked: boolean) =>
  locked
    ? 'Unlock. Painting over this segment takes its voxels.'
    : 'Lock. Painting over this segment shares its voxels instead of taking them.';

// The shared list offers every segment on every image, so a row with nothing
// stored here is the common case rather than the exception.
const revealReason = (row: Row) =>
  row.maskId ? '' : 'Nothing is painted on this image for this segment';

// Scanned rather than read off the binding: the binding's extent is the
// allocation, padded on growth and never shrunk by an erase, so its middle can
// sit slices away from anything painted. One scan per click, nothing cached.
function revealSlice(row: Row) {
  const imageId = currentImageID.value;
  if (!imageId || !row.maskId) return;
  const voxels = segmentationStore.maskVoxels(row.maskId);
  const binding = voxels.binding();
  if (!binding) return;
  const bounds = markedExtent(
    voxels.scalars(),
    binding.extent,
    binding.labelValue
  );
  if (isEmptyExtent(bounds)) return;
  revealExtent(imageId, bounds);
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
  props.registry.deleteSegment(id);
}

// --- editing state --- //

const editing = useSegmentEditing(() => props.registry);
const { editDialog, editState, editingSegment, editingName, invalidNames } =
  editing;
</script>

<template>
  <div
    v-if="!masked || currentImageID"
    class="px-2"
    :data-testid="`${noun}-list`"
  >
    <div v-if="masked" class="d-flex align-center ga-1 pt-1">
      <span class="text-overline text-medium-emphasis">{{ noun }}s</span>
      <span class="text-caption text-medium-emphasis">{{ rows.length }}</span>
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

    <div v-if="masked && viewedSegmentation" class="my-2">
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
      :create-text="`New ${noun}`"
      :hide-create="masked && viewingCine"
      @create="addNewSegment"
      class="mb-2"
    >
      <template #item-prepend="{ item }">
        <!-- dot container keeps overflowing name from squishing dot width  -->
        <div class="dot-container mr-3">
          <div class="color-dot" :style="{ background: item.color }" />
        </div>
      </template>
      <template #item-append="{ item }">
        <template v-if="masked">
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
        </template>
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

  <closeable-dialog v-if="masked" v-model="saveDialog" max-width="30%">
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
