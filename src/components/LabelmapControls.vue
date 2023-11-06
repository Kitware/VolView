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

function startEditing(id: string) {
  editDialog.value = true;
  editingLabelmapID.value = id;
  if (editingMetadata.value) {
    editState.name = editingMetadata.value.name;
  }
}

function stopEditing(commit: boolean) {
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
  <v-select
    v-if="currentImageID"
    v-model="selectedLabelmapID"
    :items="currentLabelmaps"
    item-title="name"
    item-value="id"
    placeholder="Select a labelmap"
    variant="outlined"
    density="compact"
    class="labelmap-select"
  >
    <template #append>
      <v-btn icon size="x-small" variant="flat" style="top: -4px">
        <v-icon>mdi-dots-vertical</v-icon>
        <v-menu activator="parent">
          <v-list>
            <v-list-item v-if="currentImageID" @click="createLabelmap">
              Create a new labelmap
            </v-list-item>
            <v-list-item
              v-if="selectedLabelmapID"
              @click="startEditing(selectedLabelmapID)"
            >
              Edit Name
            </v-list-item>
            <v-list-item
              v-if="selectedLabelmapID"
              @click="deleteLabelmap(selectedLabelmapID)"
            >
              Delete
            </v-list-item>
          </v-list>
        </v-menu>
      </v-btn>
    </template>
  </v-select>
  <div v-else class="text-center text-caption">No selected image</div>
  <segment-list v-if="selectedLabelmapID" :labelmap-id="selectedLabelmapID" />

  <v-dialog v-model="editDialog" max-width="400px">
    <v-card>
      <v-card-text>
        <v-text-field
          v-model="editState.name"
          :placeholder="UNNAMED_LABELMAP_NAME"
          hide-details
          @keydown.stop.enter="stopEditing(true)"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="error" @click="stopEditing(false)">Cancel</v-btn>
        <v-btn @click="stopEditing(true)">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style>
.labelmap-select > .v-input__append {
  margin-left: 8px;
}
</style>
