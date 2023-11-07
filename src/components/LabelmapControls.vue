<script setup lang="ts">
import SegmentList from '@/src/components/SegmentList.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useLabelmapStore } from '@/src/store/datasets-labelmaps';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { Maybe } from '@/src/types';
import { reactive, ref, computed, watch, toRaw } from 'vue';

const UNNAMED_LABELMAP_NAME = 'Unnamed Labelmap';

const labelmapStore = useLabelmapStore();
const { currentImageID } = useCurrentImage();

const currentLabelmaps = computed(() => {
  if (!currentImageID.value) return [];
  if (!(currentImageID.value in labelmapStore.orderByParent)) return [];
  return labelmapStore.orderByParent[currentImageID.value].map((id) => {
    return {
      id,
      name: labelmapStore.labelmapMetadata[id].name,
    };
  });
});

const paintStore = usePaintToolStore();
const selectedLabelmapID = computed({
  get: () => paintStore.activeLabelmapID,
  set: (id) => paintStore.setActiveLabelmap(id),
});

// clear selection if we delete the labelmaps
watch(currentLabelmaps, () => {
  const selection = selectedLabelmapID.value;
  if (selection && !(selection in labelmapStore.dataIndex)) {
    selectedLabelmapID.value = null;
  }
});

function deleteLabelmap(id: string) {
  labelmapStore.removeLabelmap(id);
}

// --- editing state --- //

const editingLabelmapID = ref<Maybe<string>>(null);
const editState = reactive({ name: '' });
const editDialog = ref(false);

const editingMetadata = computed(() => {
  if (!editingLabelmapID.value) return null;
  return labelmapStore.labelmapMetadata[editingLabelmapID.value];
});

const existingNames = computed(() => {
  return new Set(
    Object.values(labelmapStore.labelmapMetadata).map((meta) => meta.name)
  );
});

function isUniqueEditingName(name: string) {
  return !existingNames.value.has(name) || name === editingMetadata.value?.name;
}

const editingNameConflict = computed(() => {
  return !isUniqueEditingName(editState.name);
});

function uniqueNameRule(name: string) {
  return isUniqueEditingName(name) || 'Name is not unique';
}

function startEditing(id: string) {
  editDialog.value = true;
  editingLabelmapID.value = id;
  if (editingMetadata.value) {
    editState.name = editingMetadata.value.name;
  }
}

function stopEditing(commit: boolean) {
  if (editingNameConflict.value) return;

  editDialog.value = false;
  if (editingLabelmapID.value && commit)
    labelmapStore.updateMetadata(editingLabelmapID.value, {
      name: editState.name || UNNAMED_LABELMAP_NAME,
    });
  editingLabelmapID.value = null;
}

// --- //

function createLabelmap() {
  if (!currentImageID.value)
    throw new Error('Cannot create a labelmap without a base image');

  const id = labelmapStore.newLabelmapFromImage(currentImageID.value);
  if (!id) throw new Error('Could not create a new labelmap');

  // copy segments from current labelmap
  if (selectedLabelmapID.value) {
    const metadata = labelmapStore.labelmapMetadata[selectedLabelmapID.value];
    const copied = structuredClone(toRaw(metadata.segments));
    labelmapStore.updateMetadata(id, { segments: copied });
  }

  selectedLabelmapID.value = id;

  startEditing(id);
}
</script>

<template>
  <div class="mb-2" v-if="currentImageID">
    <v-btn
      variant="tonal"
      color="secondary"
      class="mb-4"
      @click.stop="createLabelmap"
    >
      <v-icon class="mr-1">mdi-plus</v-icon> New Labelmap
    </v-btn>
    <div class="text-grey text-subtitle-2">Segment Groups</div>
    <v-divider />
    <v-radio-group
      v-model="selectedLabelmapID"
      hide-details
      density="comfortable"
      class="my-1 segment-group-list"
    >
      <v-radio
        v-for="labelmap in currentLabelmaps"
        :key="labelmap.id"
        :value="labelmap.id"
      >
        <template #label>
          <div
            class="d-flex flex-row align-center w-100"
            :title="labelmap.name"
          >
            <span class="labelmap-name">{{ labelmap.name }}</span>
            <v-spacer />
            <v-btn
              icon="mdi-pencil"
              size="x-small"
              variant="flat"
              @click.stop="startEditing(labelmap.id)"
            ></v-btn>
            <v-btn
              icon="mdi-delete"
              size="x-small"
              variant="flat"
              @click.stop="deleteLabelmap(labelmap.id)"
            ></v-btn>
          </div>
        </template>
      </v-radio>
    </v-radio-group>
    <v-divider />
  </div>
  <div v-else class="text-center text-caption">No selected image</div>
  <segment-list v-if="selectedLabelmapID" :labelmap-id="selectedLabelmapID" />

  <v-dialog v-model="editDialog" max-width="400px">
    <v-card>
      <v-card-text>
        <v-text-field
          v-model="editState.name"
          :placeholder="UNNAMED_LABELMAP_NAME"
          :rules="[uniqueNameRule]"
          @keydown.stop.enter="stopEditing(true)"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="error" @click="stopEditing(false)">Cancel</v-btn>
        <v-btn :disabled="editingNameConflict" @click="stopEditing(true)">
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style>
.segment-group-list {
  max-height: 240px;
  overflow-y: auto;
}

.labelmap-select > .v-input__append {
  margin-left: 8px;
}

.labelmap-name {
  word-wrap: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
