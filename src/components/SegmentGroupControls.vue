<script setup lang="ts">
import SegmentList from '@/src/components/SegmentList.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { Maybe } from '@/src/types';
import { reactive, ref, computed, watch, toRaw } from 'vue';

const UNNAMED_GROUP_NAME = 'Unnamed Segment Group';

const segmentGroupStore = useSegmentGroupStore();
const { currentImageID } = useCurrentImage();

const currentSegmentGroups = computed(() => {
  if (!currentImageID.value) return [];
  const { orderByParent, metadataByID } = segmentGroupStore;
  if (!(currentImageID.value in orderByParent)) return [];
  return orderByParent[currentImageID.value].map((id) => {
    return {
      id,
      name: metadataByID[id].name,
    };
  });
});

const paintStore = usePaintToolStore();
const currentSegmentGroupID = computed({
  get: () => paintStore.activeSegmentGroupID,
  set: (id) => paintStore.setActiveLabelmap(id),
});

// clear selection if we delete the active segment group
watch(currentSegmentGroups, () => {
  const selection = currentSegmentGroupID.value;
  if (selection && !(selection in segmentGroupStore.dataIndex)) {
    currentSegmentGroupID.value = null;
  }
});

function deleteGroup(id: string) {
  segmentGroupStore.removeGroup(id);
}

// --- editing state --- //

const editingGroupID = ref<Maybe<string>>(null);
const editState = reactive({ name: '' });
const editDialog = ref(false);

const editingMetadata = computed(() => {
  if (!editingGroupID.value) return null;
  return segmentGroupStore.metadataByID[editingGroupID.value];
});

const existingNames = computed(() => {
  return new Set(
    Object.values(segmentGroupStore.metadataByID).map((meta) => meta.name)
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
  editingGroupID.value = id;
  if (editingMetadata.value) {
    editState.name = editingMetadata.value.name;
  }
}

function stopEditing(commit: boolean) {
  if (editingNameConflict.value) return;

  editDialog.value = false;
  if (editingGroupID.value && commit)
    segmentGroupStore.updateMetadata(editingGroupID.value, {
      name: editState.name || UNNAMED_GROUP_NAME,
    });
  editingGroupID.value = null;
}

// --- //

function createSegmentGroup() {
  if (!currentImageID.value)
    throw new Error('Cannot create a labelmap without a base image');

  const id = segmentGroupStore.newLabelmapFromImage(currentImageID.value);
  if (!id) throw new Error('Could not create a new labelmap');

  // copy segments from current labelmap
  if (currentSegmentGroupID.value) {
    const metadata =
      segmentGroupStore.metadataByID[currentSegmentGroupID.value];
    const copied = structuredClone(toRaw(metadata.segments));
    segmentGroupStore.updateMetadata(id, { segments: copied });
  }

  currentSegmentGroupID.value = id;

  startEditing(id);
}
</script>

<template>
  <div class="mb-2" v-if="currentImageID">
    <v-btn
      variant="tonal"
      color="secondary"
      class="mb-4"
      @click.stop="createSegmentGroup"
    >
      <v-icon class="mr-1">mdi-plus</v-icon> New Segment Group
    </v-btn>
    <div class="text-grey text-subtitle-2">Segment Groups</div>
    <v-divider />
    <v-radio-group
      v-model="currentSegmentGroupID"
      hide-details
      density="comfortable"
      class="my-1 segment-group-list"
    >
      <v-radio
        v-for="group in currentSegmentGroups"
        :key="group.id"
        :value="group.id"
      >
        <template #label>
          <div class="d-flex flex-row align-center w-100" :title="group.name">
            <span class="group-name">{{ group.name }}</span>
            <v-spacer />
            <v-btn
              icon="mdi-pencil"
              size="x-small"
              variant="flat"
              @click.stop="startEditing(group.id)"
            ></v-btn>
            <v-btn
              icon="mdi-delete"
              size="x-small"
              variant="flat"
              @click.stop="deleteGroup(group.id)"
            ></v-btn>
          </div>
        </template>
      </v-radio>
    </v-radio-group>
    <v-divider />
  </div>
  <div v-else class="text-center text-caption">No selected image</div>
  <segment-list
    v-if="currentSegmentGroupID"
    :group-id="currentSegmentGroupID"
  />

  <v-dialog v-model="editDialog" max-width="400px">
    <v-card>
      <v-card-text>
        <v-text-field
          v-model="editState.name"
          :placeholder="UNNAMED_GROUP_NAME"
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

.group-name {
  word-wrap: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
