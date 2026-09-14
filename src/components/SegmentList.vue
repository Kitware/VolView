<script setup lang="ts">
import { computed, ref } from 'vue';

import EditableItemList from '@/src/components/EditableItemList.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentGroupDialog from '@/src/components/SaveSegmentGroupDialog.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentEditing } from '@/src/composables/useSegmentEditing';
import { pulseSegmentMask } from '@/src/composables/useSegmentRevealPulse';
import { revealSegmentContent } from '@/src/core/annotations/locator';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME } from '@/src/constants';
import { useSegmentShapes } from '@/src/composables/useSegmentShapes';
import { useSegmentationStore } from '@/src/store/segmentations';
import { SEGMENT_VALUE } from '@/src/store/segmentLabelValue';
import { useSegmentStore } from '@/src/store/segments';
import { Maybe } from '@/src/types';
import type { LPSAxis } from '@/src/types/lps';
import {
  DEFAULT_SEGMENTATION_FILL_OPACITY,
  isEmptyExtent,
  markedSlices,
  type SegmentationDisplayPatch,
} from '@/src/types/segmentation';

const registry = useSegmentStore().segments;
const { shapesOf } = useSegmentShapes();
const segmentationStore = useSegmentationStore();
const { currentImageID } = useCurrentImage();

// Scoped to the viewed image: the per-image controls belong to this image's
// masks. Before storage exists, the panel presents the defaults it will use.
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

const DEFAULT_DISPLAY = {
  fillOpacity: DEFAULT_SEGMENTATION_FILL_OPACITY,
  outlineOpacity: 1,
  outlineThickness: 2,
};

const display = computed(() => viewedSegmentation.value ?? DEFAULT_DISPLAY);
const openSections = ref(['segments']);

const setDisplay = (patch: SegmentationDisplayPatch) => {
  const imageId = currentImageID.value;
  if (!imageId || viewingCine.value) return;
  const segmentation =
    viewedSegmentation.value ??
    segmentationStore.ensureSegmentationForImage(imageId);
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
function paintedSlices(maskId: Maybe<string>) {
  if (!maskId) return undefined;
  const voxels = segmentationStore.maskVoxels(maskId);
  const binding = voxels.binding();
  if (!binding) return undefined;
  const slices = markedSlices(voxels.scalars(), binding.extent, SEGMENT_VALUE);
  return slices.some((axis) => axis.length) ? slices : undefined;
}

// Paint and shapes are one segment, so both steer the jump: a view lands on the
// middle of everything the segment holds along that view's axis.
function revealSlice(row: Row) {
  const imageId = currentImageID.value;
  if (!imageId) return;
  const slicesByAxis = row.shapes.reduce<Partial<Record<LPSAxis, number[]>>>(
    (byAxis, shape) => {
      if (shape.frame != null) return byAxis;
      const axis = shape.axis as LPSAxis;
      return { ...byAxis, [axis]: [...(byAxis[axis] ?? []), shape.slice] };
    },
    {}
  );
  revealSegmentContent(imageId, {
    paintedSlicesByIJK: paintedSlices(row.maskId),
    slicesByAxis,
    frames: row.shapes.flatMap((shape) =>
      shape.frame == null ? [] : [shape.frame]
    ),
  });
  if (row.maskId) pulseSegmentMask(row.maskId);
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
  if (registry.appearanceOf(id).locked) return;
  registry.deleteSegment(id);
}

// --- editing state --- //

const editing = useSegmentEditing(() => registry);
const {
  editDialog,
  editState,
  editingSegment,
  editingName,
  editingLocked,
  invalidNames,
} = editing;
</script>

<template>
  <div v-if="currentImageID" data-testid="segment-list">
    <v-expansion-panels
      v-model="openSections"
      multiple
      variant="accordion"
      class="annotation-panels"
    >
      <v-expansion-panel value="display">
        <v-expansion-panel-title data-testid="segment-display-section">
          <v-icon class="annotation-panel-icon">mdi-tune-variant</v-icon>
          Display
        </v-expansion-panel-title>
        <v-expansion-panel-text class="display-section-body">
          <div class="display-controls">
            <div
              v-for="control in DISPLAY_CONTROLS"
              :key="control.key"
              class="display-control"
            >
              <div class="text-body-2 text-no-wrap">
                {{ control.label }}
              </div>
              <v-slider
                :label="control.label"
                min="0"
                :max="control.max"
                :step="control.step"
                density="compact"
                hide-details
                thumb-label
                :model-value="display[control.key]"
                @update:model-value="setDisplay({ [control.key]: $event })"
              />
            </div>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel value="segments">
        <div class="segment-panel-header">
          <v-expansion-panel-title data-testid="segments-section">
            <v-icon class="annotation-panel-icon">mdi-palette</v-icon>
            Segments
          </v-expansion-panel-title>
          <div class="segment-header-actions d-flex align-center ga-1">
            <v-btn
              data-testid="toggle-segments-locked-button"
              :aria-label="
                allLocked ? 'Unlock every segment' : 'Lock every segment'
              "
              icon
              size="small"
              density="compact"
              variant="plain"
              :color="allLocked ? 'error' : undefined"
              @click.stop="toggleGlobalLocked"
            >
              <v-icon>{{ allLocked ? 'mdi-lock' : 'mdi-lock-open' }}</v-icon>
              <v-tooltip location="top" activator="parent">{{
                allLocked ? 'Unlock every segment' : 'Lock every segment'
              }}</v-tooltip>
            </v-btn>

            <v-btn
              data-testid="toggle-segments-visible-button"
              :aria-label="
                allVisible ? 'Hide every segment' : 'Show every segment'
              "
              icon
              size="small"
              density="compact"
              variant="plain"
              @click.stop="toggleGlobalVisible"
            >
              <v-icon>{{ allVisible ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
              <v-tooltip location="top" activator="parent">{{
                allVisible ? 'Hide every segment' : 'Show every segment'
              }}</v-tooltip>
            </v-btn>

            <span
              class="d-inline-flex"
              :tabindex="savableReason ? 0 : undefined"
            >
              <v-btn
                data-testid="save-segments-button"
                aria-label="Save segments"
                icon
                size="small"
                density="compact"
                variant="plain"
                :disabled="!!savableReason"
                @click.stop="openSaveDialog"
              >
                <v-icon>mdi-content-save</v-icon>
              </v-btn>
              <v-tooltip location="top" activator="parent">{{
                savableReason || 'Save'
              }}</v-tooltip>
            </span>
          </div>
        </div>

        <v-expansion-panel-text>
          <editable-item-list
            v-model="selectedSegmentOn"
            :items="rows"
            item-key="id"
            item-title="name"
            create-text="New segment"
            @create="addNewSegment"
            class="segment-items mb-2"
          >
            <template #item-prepend="{ item }">
              <!-- dot container keeps overflowing name from squishing dot width  -->
              <div
                class="dot-container d-inline-flex mr-3"
                :tabindex="item.locked ? 0 : undefined"
              >
                <button
                  type="button"
                  class="color-dot"
                  data-testid="segment-color-button"
                  :aria-label="`Change color for ${item.name}`"
                  :style="{ background: item.color }"
                  :disabled="item.locked"
                  @click.stop="editing.startEditing(item.id)"
                ></button>
                <v-tooltip location="top" activator="parent">{{
                  item.locked
                    ? 'Unlock this segment to change its color'
                    : 'Change color'
                }}</v-tooltip>
              </div>
            </template>
            <template #item-append="{ item }">
              <!-- Lock is segment-only, so it sits outside the shared action order. -->
              <v-btn
                icon
                size="small"
                density="compact"
                class="mr-1"
                variant="plain"
                @click.stop="toggleLock(item.id)"
                :aria-label="`${item.locked ? 'Unlock' : 'Lock'} ${item.name}`"
                :color="item.locked ? 'error' : undefined"
              >
                <v-icon>{{
                  item.locked ? 'mdi-lock' : 'mdi-lock-open'
                }}</v-icon>
                <v-tooltip location="top" activator="parent">{{
                  lockTooltip(item.locked)
                }}</v-tooltip>
              </v-btn>
              <!-- Reveal content without changing the view's pan or zoom. -->
              <span
                class="d-inline-flex"
                :tabindex="revealReason(item) ? 0 : undefined"
              >
                <v-btn
                  icon
                  size="small"
                  density="compact"
                  class="mr-1"
                  variant="plain"
                  data-testid="reveal-segment-button"
                  :aria-label="`${viewingCine ? 'Reveal frame' : 'Reveal slice'} for ${item.name}`"
                  :disabled="!!revealReason(item)"
                  @click.stop="revealSlice(item)"
                >
                  <v-icon>mdi-target</v-icon>
                </v-btn>
                <v-tooltip location="top" activator="parent">{{
                  revealReason(item) ||
                  (viewingCine ? 'Reveal Frame' : 'Reveal Slice')
                }}</v-tooltip>
              </span>
              <span
                class="d-inline-flex"
                :tabindex="item.locked ? 0 : undefined"
              >
                <v-btn
                  icon="mdi-pencil"
                  size="small"
                  density="compact"
                  class="mr-1"
                  variant="plain"
                  data-testid="edit-segment-button"
                  :aria-label="`Edit ${item.name}`"
                  @click.stop="editing.startEditing(item.id)"
                  :disabled="item.locked"
                />
                <v-tooltip location="top" activator="parent">{{
                  item.locked ? 'Unlock this segment to edit it' : 'Edit'
                }}</v-tooltip>
              </span>
              <v-btn
                icon
                size="small"
                density="compact"
                class="mr-1"
                variant="plain"
                @click.stop="toggleVisible(item.id)"
                :aria-label="`${item.visible ? 'Hide' : 'Show'} ${item.name}`"
              >
                <v-icon style="pointer-events: none">{{
                  item.visible ? 'mdi-eye' : 'mdi-eye-off'
                }}</v-icon>
                <v-tooltip location="top" activator="parent">{{
                  item.visible ? 'Hide' : 'Show'
                }}</v-tooltip>
              </v-btn>
              <span
                class="d-inline-flex"
                :tabindex="item.locked ? 0 : undefined"
              >
                <v-btn
                  icon="mdi-delete"
                  size="small"
                  density="compact"
                  variant="plain"
                  data-testid="delete-segment-button"
                  :aria-label="`Delete ${item.name}`"
                  @click.stop="deleteSegment(item.id)"
                  :disabled="item.locked"
                />
                <v-tooltip location="top" activator="parent">{{
                  item.locked ? 'Unlock this segment to delete it' : 'Delete'
                }}</v-tooltip>
              </span>
            </template>
          </editable-item-list>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
  <div v-else class="px-3 py-2 text-center text-caption">No selected image</div>

  <isolated-dialog v-model="editDialog" max-width="800px">
    <segment-editor
      v-if="!!editingSegment"
      v-model:name="editState.name"
      :original="editingName"
      :locked="editingLocked"
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
.display-controls {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
}

.display-control {
  display: contents;
}

.display-controls :deep(.v-input__prepend) {
  display: none;
}

.segment-items :deep(.item-list-scroll) {
  /* Keep two and a half compact rows usable even when that exceeds half of a
     very short sidebar; otherwise use at most half of the module viewport. */
  max-height: max(100px, 50cqh);
  overflow-y: auto;
  scrollbar-width: thin;
}

.segment-panel-header {
  position: relative;
}

.segment-header-actions {
  position: absolute;
  z-index: 1;
  inset-block-start: 50%;
  inset-inline-end: 44px;
  transform: translateY(-50%);
}

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
.color-dot:disabled {
  pointer-events: none;
}
.shape-row {
  min-height: 36px;
  padding: 4px 8px 4px 0;
}
.shape-icon {
  opacity: var(--v-medium-emphasis-opacity);
}
</style>
