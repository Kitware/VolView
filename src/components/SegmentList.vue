<script setup lang="ts">
import EditableChipList from '@/src/components/EditableChipList.vue';
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import {
  useSegmentGroupStore,
  makeDefaultSegmentName,
} from '@/src/store/segmentGroups';
import { Maybe } from '@/src/types';
import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';
import { reactive, ref, toRefs, computed, watch } from 'vue';
import { SegmentMask } from '@/src/types/segment';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { RGBAColor } from '@kitware/vtk.js/types';

const props = defineProps({
  groupId: {
    required: true,
    type: String,
  },
});

const { groupId } = toRefs(props);

const segmentGroupStore = useSegmentGroupStore();
const paintStore = usePaintToolStore();

const segments = computed<SegmentMask[]>(() => {
  return segmentGroupStore.segmentByGroupID[groupId.value] ?? [];
});

function addNewSegment() {
  segmentGroupStore.addSegment(groupId.value);
}

// --- selection --- //

const selectedSegment = computed({
  get: () => paintStore.activeSegment,
  set: (value: Maybe<number>) => {
    paintStore.setActiveSegment(value);
  },
});

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

// --- segment opacity --- //

const selectedSegmentMask = computed(() => {
  if (!selectedSegment.value) return null;
  return segmentGroupStore.getSegment(groupId.value, selectedSegment.value);
});

const segmentOpacity = computed(() => {
  if (!selectedSegmentMask.value) return 1;
  return selectedSegmentMask.value.color[3] / 255;
});

const setSegmentOpacity = (opacity: number) => {
  if (!selectedSegmentMask.value) {
    return;
  }

  const color = selectedSegmentMask.value.color;
  segmentGroupStore.updateSegment(
    groupId.value,
    selectedSegmentMask.value.value,
    {
      color: [
        ...(color.slice(0, 3) as [number, number, number]),
        Math.round(opacity * 255),
      ],
    }
  );
};

const toggleVisible = (value: number) => {
  const segment = segmentGroupStore.getSegment(groupId.value, value);
  if (!segment) return;
  segmentGroupStore.updateSegment(groupId.value, value, {
    visible: !segment.visible,
  });
};

const allVisible = computed(() => {
  return segments.value.every((seg) => seg.visible);
});

function toggleGlobalVisible() {
  const visible = !allVisible.value;

  segments.value.forEach((seg) => {
    segmentGroupStore.updateSegment(groupId.value, seg.value, {
      visible,
    });
  });
}

// --- editing state --- //

const editingSegmentValue = ref<Maybe<number>>(null);
const editState = reactive({
  name: '',
  color: '',
});
const editDialog = ref(false);

const editingSegment = computed(() => {
  if (editingSegmentValue.value == null) return null;
  return segmentGroupStore.getSegment(groupId.value, editingSegmentValue.value);
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
}

function stopEditing(commit: boolean) {
  if (editingSegmentValue.value && commit)
    segmentGroupStore.updateSegment(groupId.value, editingSegmentValue.value, {
      name: editState.name ?? makeDefaultSegmentName(editingSegmentValue.value),
      color: hexaToRGBA(editState.color),
    });
  editingSegmentValue.value = null;
  editDialog.value = false;
}

function deleteSegment(value: number) {
  segmentGroupStore.deleteSegment(groupId.value, value);
}

function deleteEditingSegment() {
  if (editingSegmentValue.value) deleteSegment(editingSegmentValue.value);
  stopEditing(false);
}
</script>

<template>
  <v-btn @click.stop="toggleGlobalVisible" class="my-1">
    Toggle Segments
    <slot name="append">
      <v-icon v-if="allVisible" class="pl-2">mdi-eye</v-icon>
      <v-icon v-else class="pl-2">mdi-eye-off</v-icon>
      <v-tooltip location="top" activator="parent">{{
        allVisible ? 'Hide' : 'Show'
      }}</v-tooltip>
    </slot>
  </v-btn>

  <v-slider
    class="mx-4 my-1"
    label="Segment Opacity"
    min="0"
    max="1"
    step="0.01"
    density="compact"
    hide-details
    thumb-label
    :model-value="segmentOpacity"
    @update:model-value="setSegmentOpacity($event)"
  />

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
        <div
          class="color-dot"
          :style="{ background: rgbaToHexa([...item.color.slice(0,3), 255] as RGBAColor) }"
        />
      </div>
    </template>
    <template #item-append="{ key, item }">
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
      <v-btn
        icon="mdi-pencil"
        size="small"
        density="compact"
        class="ml-auto mr-1"
        variant="plain"
        @click.stop="startEditing(key as number)"
      />
      <v-btn
        icon="mdi-delete"
        size="small"
        density="compact"
        class="ml-auto"
        variant="plain"
        @click.stop="deleteSegment(key as number)"
      />
    </template>
  </editable-chip-list>

  <isolated-dialog v-model="editDialog" @keydown.stop max-width="800px">
    <segment-editor
      v-if="!!editingSegment"
      v-model:name="editState.name"
      v-model:color="editState.color"
      @delete="deleteEditingSegment"
      @cancel="stopEditing(false)"
      @done="stopEditing(true)"
      :invalidNames="invalidNames"
    />
  </isolated-dialog>
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
