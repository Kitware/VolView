<script setup lang="ts">
import EditableChipList from '@/src/components/EditableChipList.vue';
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

const segments = computed<LabelMapSegment[]>(() => {
  return labelmapStore.segmentsByLabelmapID[labelmapId.value] ?? [];
});

function addNewSegment() {
  labelmapStore.addSegment(labelmapId.value);
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
  <editable-chip-list
    v-model="selectedSegment"
    :items="segments"
    item-key="value"
    item-title="name"
    create-label-text="New segment"
    @create="addNewSegment"
  >
    <template #item-prepend="{ item }">
      <!-- dot container keeps overflowing name from squishing dot width  -->
      <div class="dot-container mr-3">
        <div
          class="color-dot"
          :style="{ background: rgbaToHexa(item.color) }"
        />
      </div>
    </template>
    <template #item-append="{ key }">
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
