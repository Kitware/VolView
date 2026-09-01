<script setup lang="ts">
import EditableChipList from '@/src/components/EditableChipList.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import { makeDefaultSegmentName } from '@/src/store/segmentGroups';
import {
  useSegmentationStore,
  type SegmentPatch,
} from '@/src/store/segmentations';
import { Maybe } from '@/src/types';
import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';
import { reactive, ref, toRefs, computed, watch } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';
import ColorDot from '@/src/components/ColorDot.vue';

const props = defineProps({
  groupId: {
    required: true,
    type: String,
  },
});

const { groupId } = toRefs(props);

const segmentationStore = useSegmentationStore();

const segmentation = computed(() =>
  segmentationStore.getSegmentationForArtifact(groupId.value)
);

// The chip list is still keyed on label value; the edits and the selection
// below route through the segment's stable id.
const segments = computed(() =>
  segmentationStore.segmentsForArtifact(groupId.value).map((segment) => ({
    id: segment.id,
    value: segment.representations.labelmap!.labelValue,
    name: segment.name,
    color: segment.color,
    visible: segment.visible,
    locked: segment.locked,
  }))
);

const segmentByValue = (value: number) =>
  segments.value.find((segment) => segment.value === value);

function updateByValue(value: number, patch: SegmentPatch) {
  const target = segmentation.value;
  const segment = segmentByValue(value);
  if (!target || !segment) return;
  segmentationStore.updateSegment(target.id, segment.id, patch);
}

// --- selection --- //

const selectedSegment = computed({
  get: () => {
    const target = segmentationStore.activeTarget;
    if (!target) return null;
    const segment = segments.value.find((seg) => seg.id === target.segmentId);
    return segment ? segment.value : null;
  },
  set: (value: Maybe<number>) => {
    const target = segmentation.value;
    const segment = value == null ? undefined : segmentByValue(value);
    if (!target || !segment) {
      segmentationStore.clearActiveSegment();
      return;
    }
    segmentationStore.setActiveSegment(target.id, segment.id);
  },
});

function addNewSegment() {
  const target = segmentation.value;
  if (!target) return;
  const segment = segmentationStore.createSegment(target.id);
  const binding = segmentationStore.ensureLabelmapBinding(
    target.id,
    segment.id,
    groupId.value
  );
  selectedSegment.value = binding.labelValue;
}

// reset selection when necessary
watch(
  segments,
  (segments_) => {
    let reset = true;
    if (segments_ && selectedSegment.value) {
      reset = !segments_.find((seg) => seg.value === selectedSegment.value);
    }

    if (reset) {
      selectedSegment.value = segments_?.length ? segments_[0].value : null;
    }
  },
  { immediate: true }
);

const toggleVisible = (value: number) => {
  const segment = segmentByValue(value);
  if (!segment) return;
  updateByValue(value, { visible: !segment.visible });
};

const allVisible = computed(() => {
  return segments.value.every((seg) => seg.visible);
});

const allLocked = computed(() => {
  return segments.value.every((seg) => seg.locked);
});

function toggleGlobalVisible() {
  const visible = !allVisible.value;

  segments.value.forEach((seg) => {
    updateByValue(seg.value, { visible });
  });
}

function toggleGlobalLocked() {
  const locked = !allLocked.value;

  segments.value.forEach((seg) => {
    updateByValue(seg.value, { locked });
  });
}

// --- editing state --- //

const editingSegmentValue = ref<Maybe<number>>(null);
const editState = reactive({
  name: '',
  color: '',
  opacity: 1,
});
const editDialog = ref(false);

const editingSegment = computed(() => {
  if (editingSegmentValue.value == null) return null;
  return segmentByValue(editingSegmentValue.value) ?? null;
});
const invalidNames = computed(() => {
  const names = new Set(segments.value.map((seg) => seg.name));
  const currentName = editingSegment.value?.name;
  if (currentName) names.delete(currentName); // allow current name
  return names;
});

function startEditing(value: number) {
  editDialog.value = true;
  editingSegmentValue.value = value;
  if (!editingSegment.value) return;
  editState.name = editingSegment.value.name;
  editState.color = rgbaToHexa(editingSegment.value.color);
  editState.opacity = editingSegment.value.color[3] / 255;
}

function stopEditing(commit: boolean) {
  if (editingSegmentValue.value && commit) {
    const color = [
      ...(hexaToRGBA(editState.color).slice(0, 3) as [number, number, number]),
      Math.round(editState.opacity * 255),
    ] as RGBAColor;
    updateByValue(editingSegmentValue.value, {
      name: editState.name ?? makeDefaultSegmentName(editingSegmentValue.value),
      color,
    });
  }
  editingSegmentValue.value = null;
  editDialog.value = false;
}

function deleteSegment(value: number) {
  const target = segmentation.value;
  const segment = segmentByValue(value);
  if (!target || !segment) return;
  segmentationStore.deleteSegment(target.id, segment.id);
}

function deleteEditingSegment() {
  if (editingSegmentValue.value) deleteSegment(editingSegmentValue.value);
  stopEditing(false);
}

/**
 * Toggles the lock state of a segment.
 * Locked segments cannot be edited or painted over.
 *
 * @param value - The segment value to toggle lock state for
 */
const toggleLock = (value: number) => {
  const seg = segmentByValue(value);
  if (seg) {
    updateByValue(value, { locked: !seg.locked });
  }
};
</script>

<template>
  <div class="px-3">
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
    </div>

    <editable-chip-list
      v-model="selectedSegment"
      :items="segments"
      item-key="value"
      item-title="name"
      create-label-text="New segment"
      @create="addNewSegment"
      class="my-4"
    >
      <template #item-prepend="{ item }">
        <!-- dot container keeps overflowing name from squishing dot width  -->
        <div class="dot-container mr-3">
          <ColorDot :color="item.color" />
        </div>
      </template>
      <template #item-append="{ key, item }">
        <!-- Lock/unlock segment button -->
        <v-btn
          icon
          size="small"
          density="compact"
          class="mr-1"
          variant="plain"
          @click.stop="toggleLock(key as number)"
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
          @click.stop="toggleVisible(key as number)"
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
          @click.stop="startEditing(key as number)"
          :disabled="item.locked"
        />
        <!-- Delete segment button (disabled when locked) -->
        <v-btn
          icon="mdi-delete"
          size="small"
          density="compact"
          class="ml-auto"
          variant="plain"
          @click.stop="deleteSegment(key as number)"
          :disabled="item.locked"
        />
      </template>
    </editable-chip-list>
  </div>

  <isolated-dialog v-model="editDialog" @keydown.stop max-width="800px">
    <segment-editor
      v-if="!!editingSegment"
      v-model:name="editState.name"
      v-model:color="editState.color"
      v-model:opacity="editState.opacity"
      @delete="deleteEditingSegment"
      @cancel="stopEditing(false)"
      @done="stopEditing(true)"
      :invalidNames="invalidNames"
    />
  </isolated-dialog>
</template>

<style scoped>
.dot-container {
  width: 18px;
}
</style>
