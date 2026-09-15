<script setup lang="ts">
import { computed, ref } from 'vue';

import EditableItemList from '@/src/components/EditableItemList.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import ColorDot from '@/src/components/ColorDot.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentationDialog from '@/src/segmentation/components/SaveSegmentationDialog.vue';
import SegmentEditor from '@/src/segmentation/components/SegmentEditor.vue';
import SegmentListActions from '@/src/segmentation/components/SegmentListActions.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { deleteSegmentAndReport } from '@/src/segmentation/deleteSegment';
import { useSegmentEditing } from '@/src/segmentation/composables/useSegmentEditing';
import { pulseSegmentMask } from '@/src/segmentation/rendering/revealPulse';
import { revealSegmentContent } from '@/src/core/annotations/locator';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { SEGMENT_SHORTCUT_ACTIONS } from '@/src/constants';
import {
  actionToKey,
  readableBinding,
} from '@/src/composables/useKeyboardShortcuts';
import { useSegmentShapes } from '@/src/segmentation/composables/useSegmentShapes';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import useLoadDataStore from '@/src/store/load-data';
import type { LPSAxis } from '@/src/types/lps';
import {
  DEFAULT_SEGMENTATION_DISPLAY,
  maskHasContent,
  maskScalars,
  segmentationHasContent,
  type SegmentMask,
  type SegmentationDisplayPatch,
} from '@/src/segmentation/model';
import { markedSlices } from '@/src/segmentation/geometry';

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

const paintedMask = (segmentId: string) => {
  const mask = segmentationStore.maskFor(currentImageID.value, segmentId);
  return mask && maskHasContent(mask) ? mask : undefined;
};

type Row = {
  id: string;
  shortcut: string | undefined;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  shapeCount: number;
};

// Fields compare by identity, which the constraint keeps meaningful: a row
// that gained an object or array field would never equal its predecessor.
const sameRow = <
  R extends Record<keyof R, string | number | boolean | undefined>,
>(
  one: R,
  other: R
) => (Object.keys(one) as (keyof R)[]).every((key) => one[key] === other[key]);

// Unchanged rows keep their identity: EditableItemList memoizes on it, and a
// ruler drag recomputes every row's shape count per pointer move.
// Rows omit mask bounds, so growing a painted mask does not rebuild the list.
const rows = computed((previous?: Row[]) => {
  const before = new Map(previous?.map((row) => [row.id, row] as const));
  return registry.segmentList.value.map((segment, index) => {
    const appearance = registry.appearanceOf(segment.id);
    const row: Row = {
      id: segment.id,
      shortcut: SEGMENT_SHORTCUT_ACTIONS[index]
        ? readableBinding(actionToKey.value[SEGMENT_SHORTCUT_ACTIONS[index]])
        : undefined,
      name: appearance.displayName,
      color: appearance.cssColor,
      visible: appearance.visible,
      locked: appearance.locked,
      shapeCount: shapesOf(segment.id).length,
    };
    const kept = before.get(segment.id);
    return kept && sameRow(kept, row) ? kept : row;
  });
});

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

const display = computed(
  () => viewedSegmentation.value ?? DEFAULT_SEGMENTATION_DISPLAY
);
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
  const segmentation = viewedSegmentation.value;
  // Records alone save nothing: a segment resolved here but never painted
  // leaves an empty mask, so what is offered follows the voxels.
  if (!segmentation || !segmentationHasContent(segmentation))
    return 'Nothing is painted on this image yet';
  return '';
});

function openSaveDialog() {
  if (savableReason.value) return;
  saveDialog.value = true;
}

// --- row actions --- //

const toggleVisible = (id: string) =>
  registry.updateSegment(id, { visible: !registry.appearanceOf(id).visible });

const toggleLock = (id: string) =>
  registry.updateSegment(id, { locked: !registry.appearanceOf(id).locked });

// A restore or labelmap conversion still under way may yet fill an empty row.
const loadDataStore = useLoadDataStore();
const masksArriving = computed(
  () =>
    loadDataStore.isLoading || segmentationStore.convertingLabelmaps.size > 0
);

const revealReason = (row: Row) => {
  if (paintedMask(row.id) || row.shapeCount) return '';
  return masksArriving.value
    ? 'Still loading'
    : 'This segment has nothing on this image';
};

// The binding extent is padded and never shrunk, so scan for painted slices.
function paintedSlices({ representations }: SegmentMask) {
  const binding = representations.labelmap;
  if (!binding) return undefined;
  const slices = markedSlices(maskScalars(binding.image), binding.extent);
  return slices.some((axis) => axis.length) ? slices : undefined;
}

// Paint and shapes are one segment, so both steer the jump: a view lands on the
// middle of everything the segment holds along that view's axis.
function revealSlice(row: Row) {
  const mask = paintedMask(row.id);
  const imageId = currentImageID.value;
  if (!imageId) return;
  const shapes = shapesOf(row.id);
  const slicesByAxis: Partial<Record<LPSAxis, number[]>> = {};
  shapes.forEach(({ frame, axis, slice }) => {
    if (frame == null && axis) (slicesByAxis[axis] ??= []).push(slice);
  });
  revealSegmentContent(imageId, {
    paintedSlicesByIJK: mask && paintedSlices(mask),
    slicesByAxis,
    frames: shapes.flatMap((shape) =>
      shape.frame == null ? [] : [shape.frame]
    ),
  });
  if (mask) pulseSegmentMask(mask.id);
}

const noSegmentsReason = computed(() =>
  rows.value.length ? '' : 'No segments yet'
);

// An empty list shows the open eye and lock a new segment starts with.
const allVisible = computed(() =>
  rows.value.every((segment) => segment.visible)
);

const allLocked = computed(
  () => rows.value.length > 0 && rows.value.every((segment) => segment.locked)
);

const setAll = (key: 'visible' | 'locked', value: boolean) =>
  rows.value.forEach((row) => registry.updateSegment(row.id, { [key]: value }));

// --- editing state --- //

const editing = useSegmentEditing(registry);
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
  <div
    v-if="currentImageID"
    data-testid="segment-list"
    :aria-busy="masksArriving"
  >
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
        <v-expansion-panel-text>
          <div class="display-controls" :tabindex="viewingCine ? 0 : undefined">
            <div
              v-for="control in DISPLAY_CONTROLS"
              :key="control.key"
              class="display-control"
            >
              <div class="text-body-2 text-no-wrap">
                {{ control.label }}
              </div>
              <v-slider
                :name="control.label"
                min="0"
                :max="control.max"
                :step="control.step"
                density="compact"
                hide-details
                thumb-label
                :disabled="viewingCine"
                :model-value="display[control.key]"
                @update:model-value="setDisplay({ [control.key]: $event })"
              />
            </div>
            <v-tooltip v-if="viewingCine" location="top" activator="parent">
              A clip has no segmentation to display
            </v-tooltip>
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
            <reasoned-action
              :reason="noSegmentsReason"
              :tooltip="
                allLocked ? 'Unlock every segment' : 'Lock every segment'
              "
              v-slot="{ disabled }"
            >
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
                :disabled="disabled"
                @click.stop="setAll('locked', !allLocked)"
              >
                <v-icon>{{ allLocked ? 'mdi-lock' : 'mdi-lock-open' }}</v-icon>
              </v-btn>
            </reasoned-action>

            <reasoned-action
              :reason="noSegmentsReason"
              :tooltip="
                allVisible ? 'Hide every segment' : 'Show every segment'
              "
              v-slot="{ disabled }"
            >
              <v-btn
                data-testid="toggle-segments-visible-button"
                :aria-label="
                  allVisible ? 'Hide every segment' : 'Show every segment'
                "
                icon
                size="small"
                density="compact"
                variant="plain"
                :disabled="disabled"
                @click.stop="setAll('visible', !allVisible)"
              >
                <v-icon>{{ allVisible ? 'mdi-eye' : 'mdi-eye-off' }}</v-icon>
              </v-btn>
            </reasoned-action>

            <reasoned-action
              :reason="savableReason"
              tooltip="Save"
              v-slot="{ disabled }"
            >
              <v-btn
                data-testid="save-segments-button"
                aria-label="Save segments"
                icon
                size="small"
                density="compact"
                variant="plain"
                :disabled="disabled"
                @click.stop="openSaveDialog"
              >
                <v-icon>mdi-content-save</v-icon>
              </v-btn>
            </reasoned-action>
          </div>
        </div>

        <v-expansion-panel-text class="segments-section-body">
          <editable-item-list
            :model-value="registry.selectedSegmentId.value"
            @update:model-value="registry.selectSegment"
            :selection-revision="registry.selectionRevision.value"
            :items="rows"
            reorderable
            @move="registry.moveSegment"
            item-key="id"
            item-title="name"
            create-text="New segment"
            @create="registry.addSegment()"
            class="segment-items"
          >
            <template #item-prepend="{ item }">
              <!-- dot container keeps overflowing name from squishing dot width  -->
              <reasoned-action
                class="dot-container mr-3"
                :reason="
                  item.locked ? 'Unlock this segment to change its color' : ''
                "
                tooltip="Change color"
                v-slot="{ disabled }"
              >
                <button
                  type="button"
                  class="color-button"
                  data-testid="segment-color-button"
                  :aria-label="`Change color for ${item.name}`"
                  :disabled="disabled"
                  @click.stop="editing.startEditing(item.id)"
                >
                  <color-dot :color="item.color" />
                </button>
              </reasoned-action>
            </template>
            <template #item-append="{ item }">
              <span class="segment-shortcut-slot">
                <kbd
                  v-if="item.shortcut"
                  class="segment-shortcut"
                  :title="`Select ${item.name}: ${item.shortcut}`"
                  >{{ item.shortcut }}</kbd
                >
              </span>
              <segment-list-actions
                :name="item.name"
                :locked="item.locked"
                :visible="item.visible"
                :viewing-cine="viewingCine"
                :reveal-reason="revealReason(item)"
                @toggle-lock="toggleLock(item.id)"
                @reveal="revealSlice(item)"
                @edit="editing.startEditing(item.id)"
                @toggle-visible="toggleVisible(item.id)"
                @delete="deleteSegmentAndReport(registry, item.id)"
              />
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
      :invalid-names="invalidNames"
    />
  </isolated-dialog>

  <closeable-dialog v-model="saveDialog" max-width="30%">
    <template v-slot="{ close }">
      <!-- The overlay keeps its content once opened, so the dialog is mounted
           per open to read the segmentation as it stands now. -->
      <save-segmentation-dialog
        v-if="saveDialog && viewedSegmentation"
        :id="viewedSegmentation.id"
        @done="close"
      />
    </template>
  </closeable-dialog>
</template>

<style scoped>
.segment-shortcut-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  margin-inline: 4px;
}
.segment-shortcut {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 3px;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  opacity: var(--v-medium-emphasis-opacity);
}

.display-controls {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
}

.display-control {
  display: contents;
}

.segment-items :deep(.item-list-scroll) {
  /* Keep two and a half compact rows usable even when that exceeds half of a
     very short sidebar; otherwise use at most half of the module viewport. */
  max-height: max(100px, 50cqh);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}

.segment-items :deep(.create-row-wrapper) {
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}

.segments-section-body :deep(.v-expansion-panel-text__wrapper) {
  padding-bottom: 4px;
}

.segment-panel-header {
  position: relative;
}

.segment-items :deep(.item-row),
.segment-items :deep(.create-row) {
  padding-inline: 16px;
}

.segment-panel-header :deep(.v-expansion-panel-title) {
  padding-inline-end: 8px;
}

.segment-header-actions {
  position: absolute;
  z-index: 1;
  inset-block-start: 50%;
  /* Match the panel inset and row padding, including its scrollbar gutter. */
  inset-inline-end: 29px;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
  transform: translateY(-50%);
}

.color-button {
  display: inline-flex;
}
.dot-container {
  width: 18px;
}
.color-button:disabled {
  pointer-events: none;
}
</style>
