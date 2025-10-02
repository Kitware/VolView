<script setup lang="ts">
import SegmentGroupOpacity from '@/src/components/SegmentGroupOpacity.vue';
import SegmentList from '@/src/components/SegmentList.vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSegmentGroupDialog from '@/src/components/SaveSegmentGroupDialog.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useDatasetStore } from '@/src/store/datasets';
import {
  getSelectionName,
  selectionEquals,
  DataSelection,
} from '@/src/utils/dataSelection';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useGlobalLayerColorConfig } from '@/src/composables/useGlobalLayerColorConfig';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { Maybe } from '@/src/types';
import { reactive, ref, computed, watch, toRaw } from 'vue';
import { useMultiSelection } from '@/src/composables/useMultiSelection';

const UNNAMED_GROUP_NAME = 'Unnamed Segment Group';

const segmentGroupStore = useSegmentGroupStore();
const { currentImageID } = useCurrentImage();
const dataStore = useDatasetStore();

const currentSegmentGroups = computed(() => {
  if (!currentImageID.value) return [];
  const { orderByParent, metadataByID } = segmentGroupStore;
  if (!(currentImageID.value in orderByParent)) return [];
  return orderByParent[currentImageID.value].map((id) => {
    const { sampledConfig, updateConfig } = useGlobalLayerColorConfig(id);
    return {
      id,
      name: metadataByID[id].name,
      visibility: sampledConfig.value?.config?.blendConfig.visibility ?? true,
      toggleVisibility: () => {
        const currentBlend = sampledConfig.value!.config!.blendConfig;
        updateConfig({
          blendConfig: {
            ...currentBlend,
            visibility: !currentBlend.visibility,
          },
        });
      },
    };
  });
});

const paintStore = usePaintToolStore();
const currentSegmentGroupID = computed({
  get: () => paintStore.activeSegmentGroupID,
  set: (id) => paintStore.setActiveSegmentGroup(id),
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

// Collect images that can be converted into
// a SegmentGroup for the current background image.
const segmentGroupConvertibles = computed(() => {
  const primarySelection = currentImageID.value;
  if (!primarySelection) return [];
  return dataStore.idsAsSelections
    .filter((selection) => !selectionEquals(selection, primarySelection))
    .map((selection) => ({
      selection,
      name: getSelectionName(selection),
    }));
});

function createSegmentGroupFromImage(selection: DataSelection) {
  const primarySelection = currentImageID.value;
  if (!primarySelection) {
    throw new Error('No primary selection');
  }
  segmentGroupStore.convertImageToLabelmap(selection, primarySelection);
}

const saveId = ref('');
const saveDialog = ref(false);
function openSaveDialog(id: string) {
  saveId.value = id;
  saveDialog.value = true;
}

const segGroupIds = computed(() =>
  currentSegmentGroups.value.map((group) => group.id)
);

const { selected, selectedAll, selectedSome } = useMultiSelection(segGroupIds);

// ensure currentSegmentGroupID is always in selected
watch(
  // includes currentImageID to reselect when switching images because currentSegmentGroupID is not updated on image change
  [currentSegmentGroupID, currentImageID],
  () => {
    const groupId = currentSegmentGroupID.value;
    if (!groupId) return;
    selected.value = [groupId];
  },
  { immediate: true }
);

function toggleSelectAll() {
  if (selectedAll.value && currentSegmentGroupID.value) {
    selected.value = [currentSegmentGroupID.value];
  } else if (selectedAll.value) {
    selected.value = [];
  } else {
    selected.value = segGroupIds.value;
  }
}

const allHidden = computed(() => {
  return selected.value
    .map((id) => currentSegmentGroups.value.find((group) => id === group.id))
    .filter((group): group is NonNullable<typeof group> => group != null)
    .every((group) => !group.visibility);
});

function toggleGlobalVisibility() {
  const shouldShow = allHidden.value;
  selected.value.forEach((id) => {
    const group = currentSegmentGroups.value.find((g) => g.id === id);
    if (group) {
      const { sampledConfig, updateConfig } = useGlobalLayerColorConfig(id);
      const currentBlend = sampledConfig.value!.config!.blendConfig;
      updateConfig({
        blendConfig: {
          ...currentBlend,
          visibility: shouldShow,
        },
      });
    }
  });
}

function deleteSelected() {
  selected.value.forEach((id) => deleteGroup(id));
}
</script>

<template>
  <div class="mt-2" v-if="currentImageID">
    <div
      class="text-grey text-subtitle-2 d-flex align-center justify-space-evenly mb-2"
    >
      <v-btn
        variant="tonal"
        color="secondary"
        density="compact"
        @click.stop="createSegmentGroup"
      >
        <v-icon class="mr-1">mdi-plus</v-icon> New Group
      </v-btn>
      <v-menu location="bottom">
        <template v-slot:activator="{ props }">
          <v-btn
            variant="tonal"
            color="secondary"
            density="compact"
            v-bind="props"
          >
            <v-icon class="mr-1">mdi-chevron-down</v-icon>From Image
          </v-btn>
        </template>
        <v-list v-if="segmentGroupConvertibles.length !== 0">
          <v-list-item
            v-for="(item, index) in segmentGroupConvertibles"
            :key="index"
            @click="createSegmentGroupFromImage(item.selection)"
          >
            {{ item.name }}
            <v-tooltip activator="parent" location="end" max-width="200px">
              Add as segment group
            </v-tooltip>
          </v-list-item>
        </v-list>
        <v-list v-else>
          <v-list-item class="font-italic" title="No eligible images found" />
        </v-list>
      </v-menu>
    </div>

    <segment-group-opacity
      v-if="currentSegmentGroupID"
      :group-id="currentSegmentGroupID"
      :selected="selected"
    />

    <div class="d-flex align-center" v-if="currentSegmentGroups.length > 0">
      <v-checkbox
        class="ml-3"
        :indeterminate="selectedSome && !selectedAll"
        label="Select All"
        :model-value="selectedAll"
        @update:model-value="toggleSelectAll"
        density="compact"
        hide-details
      />
      <v-btn
        icon
        variant="text"
        :disabled="selected.length === 0"
        @click.stop="toggleGlobalVisibility"
      >
        <v-icon v-if="allHidden">mdi-eye-off</v-icon>
        <v-icon v-else>mdi-eye</v-icon>
        <v-tooltip location="top" activator="parent">
          {{ allHidden ? 'Show' : 'Hide' }} selected
        </v-tooltip>
      </v-btn>
      <v-btn
        icon
        variant="text"
        :disabled="selected.length === 0"
        @click.stop="deleteSelected"
      >
        <v-icon>mdi-delete</v-icon>
        <v-tooltip location="top" activator="parent">
          Delete selected
        </v-tooltip>
      </v-btn>
    </div>
    <v-list density="comfortable" class="my-1 segment-group-list">
      <v-list-item
        v-for="group in currentSegmentGroups"
        :key="group.id"
        :active="currentSegmentGroupID === group.id"
        @click="currentSegmentGroupID = group.id"
      >
        <div class="d-flex flex-row align-center w-100" :title="group.name">
          <v-checkbox
            class="no-grow mr-4"
            density="compact"
            hide-details
            @click.stop
            :value="group.id"
            v-model="selected"
            :disabled="group.id === currentSegmentGroupID"
          />
          <span class="group-name">{{ group.name }}</span>
          <v-spacer />
          <v-btn
            icon
            variant="text"
            size="small"
            @click.stop="group.toggleVisibility"
          >
            <v-icon v-if="group.visibility" style="pointer-events: none"
              >mdi-eye</v-icon
            >
            <v-icon v-else style="pointer-events: none">mdi-eye-off</v-icon>
            <v-tooltip location="left" activator="parent">
              {{ group.visibility ? 'Hide' : 'Show' }}
            </v-tooltip>
          </v-btn>
          <v-btn
            icon="mdi-content-save"
            size="small"
            variant="text"
            @click.stop="openSaveDialog(group.id)"
          />
          <v-btn
            icon="mdi-pencil"
            size="small"
            variant="text"
            @click.stop="startEditing(group.id)"
          />
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            @click.stop="deleteGroup(group.id)"
          />
        </div>
      </v-list-item>
      <v-list-item v-if="currentSegmentGroups.length === 0">
        <div class="text-center text-grey-darken-1 py-4 w-100">
          Create a segment group with the above buttons or click the paint tool
        </div>
      </v-list-item>
    </v-list>

    <v-divider class="my-4" />
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

  <closeable-dialog v-model="saveDialog" max-width="30%">
    <template v-slot="{ close }">
      <save-segment-group-dialog :id="saveId" @done="close" />
    </template>
  </closeable-dialog>
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
  padding-right: 10px;
  text-align: left;
}

.no-grow {
  flex: 0 0 auto;
}
</style>
