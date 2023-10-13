<script setup lang="ts">
import SegmentEditor from '@/src/components/SegmentEditor.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import {
  useLabelmapStore,
  makeDefaultSegmentName,
} from '@/src/store/datasets-labelmaps';
import { Maybe } from '@/src/types';
import { hexaToRGBA, rgbaToHexa } from '@/src/utils/color';
import { reactive, ref, toRefs, computed, watch } from 'vue';
import { LabelMapSegment } from '@/src/types/labelmap';
import { usePaintToolStore } from '@/src/store/tools/paint';

const props = defineProps({
  labelmapId: {
    required: true,
    type: String,
  },
});

const { labelmapId } = toRefs(props);

const labelmapStore = useLabelmapStore();
const paintStore = usePaintToolStore();

const segments = computed<Maybe<LabelMapSegment[]>>(() => {
  return labelmapStore.segmentsByLabelmapID[labelmapId.value];
});

function addNewSegment() {
  labelmapStore.addSegment(labelmapId.value);
}

// --- selection --- //

const selectedSegment = ref<Maybe<number>>(null);

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

// TODO disable the paint tool when no segments?

// sync selection to paint brush value
watch(
  selectedSegment,
  (value) => {
    if (value) paintStore.setBrushValue(value);
    // else disable paint tool
  },
  { immediate: true }
);

// --- editing state --- //

const editingSegmentValue = ref<Maybe<number>>(null);
const editState = reactive({
  name: '',
  color: '',
});
const editDialog = ref(false);

const editingSegment = computed(() => {
  if (editingSegmentValue.value == null) return null;
  return labelmapStore.getSegment(labelmapId.value, editingSegmentValue.value);
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
    labelmapStore.updateSegment(labelmapId.value, editingSegmentValue.value, {
      name: editState.name ?? makeDefaultSegmentName(editingSegmentValue.value),
      color: hexaToRGBA(editState.color),
    });
  editingSegmentValue.value = null;
  editDialog.value = false;
}

function deleteSegment(value: number) {
  labelmapStore.deleteSegment(labelmapId.value, value);
}

function deleteEditingSegment() {
  if (editingSegmentValue.value) deleteSegment(editingSegmentValue.value);
  stopEditing(false);
}
</script>

<template>
  <v-item-group mandatory selected-class="selected" v-model="selectedSegment">
    <v-item
      v-for="segment in segments"
      :key="segment.value"
      :value="segment.value"
      v-slot="{ selectedClass, toggle }"
    >
      <v-list-item
        :class="[selectedClass, 'my-1', 'segment']"
        @click.stop="toggle"
      >
        {{ segment.name }}
        <template #prepend>
          <div
            class="dot"
            :style="{
              backgroundColor: rgbaToHexa(segment.color),
            }"
          ></div>
        </template>
        <template #append>
          <v-btn
            icon
            size="x-small"
            variant="plain"
            @click.stop="startEditing(segment.value)"
          >
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="plain"
            @click.stop="deleteSegment(segment.value)"
          >
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </template>
      </v-list-item>
    </v-item>
    <v-list-item class="text-center" @click.stop="addNewSegment">
      <v-icon>mdi-plus</v-icon>
      New segment
    </v-list-item>
  </v-item-group>

  <isolated-dialog v-model="editDialog" @keydown.stop max-width="800px">
    <segment-editor
      v-if="!!editingSegment"
      v-model:name="editState.name"
      v-model:color="editState.color"
      @delete="deleteEditingSegment"
      @cancel="stopEditing(false)"
      @done="stopEditing(true)"
    />
  </isolated-dialog>
</template>

<style scoped>
.selected {
  background: rgba(var(--v-theme-selection-bg-color));
}

.dot {
  width: 16px;
  height: 16px;
  border-radius: 8px;
  background: yellow;
  margin-right: 8px;
  border: 1px solid #111;
}

.segment {
  overflow: hidden;
  text-overflow: clip;
}
</style>
