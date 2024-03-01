<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import EditableChipList from '@/src/components/EditableChipList.vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import { Maybe } from '@/src/types';
import ToolLabelEditor from '@/src/components/ToolLabelEditor.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import { nonNullable } from '@/src/utils';

const props = defineProps<{
  labelsStore: LabelsStore<Pick<AnnotationTool, 'strokeWidth'>>;
}>();

const labels = computed(() =>
  Object.entries(props.labelsStore.labels).map(([id, label]) => ({
    id,
    name: label.labelName ?? '(no name)',
    color: label.color,
  }))
);

const selectedLabel = computed({
  get: () => props.labelsStore.activeLabel,
  set: (id) => {
    if (id != null) props.labelsStore.setActiveLabel(id);
  },
});

// --- editing state --- //

type LabelID = keyof typeof props.labelsStore.labels;
const editingLabelID = ref<Maybe<LabelID>>(undefined);
const editDialog = ref(false);
const editState = reactive({
  labelName: '',
  strokeWidth: 1,
  color: '',
});

const editingLabel = computed(() => {
  if (!editingLabelID.value) return null;
  return props.labelsStore.labels[editingLabelID.value];
});

const invalidNames = computed(() => {
  const names = new Set(
    Object.values(props.labelsStore.labels)
      .map(({ labelName }) => labelName)
      .filter(nonNullable)
  );
  const currentName = editingLabel.value?.labelName;
  if (currentName) names.delete(currentName); // allow current name
  return names;
});

const makeUniqueName = (name: string) => {
  const existingNames = new Set(
    Object.values(props.labelsStore.labels).map((label) => label.labelName)
  );
  let uniqueName = name;
  let i = 1;
  while (existingNames.has(uniqueName)) {
    uniqueName = `${name} (${i})`;
    i++;
  }
  return uniqueName;
};

const createLabel = () => {
  const labelName = makeUniqueName('New Label');
  editingLabelID.value = props.labelsStore.addLabel({ labelName });
};

function startEditing(label: LabelID) {
  editDialog.value = true;
  editingLabelID.value = label;
  if (editingLabel.value) {
    editState.labelName = editingLabel.value.labelName ?? '';
    editState.strokeWidth = editingLabel.value.strokeWidth ?? 0;
    editState.color = editingLabel.value.color ?? '';
  }
}

function stopEditing(commit: boolean) {
  if (editingLabelID.value && commit) {
    props.labelsStore.updateLabel(editingLabelID.value, editState);
  }
  editDialog.value = false;
  editingLabelID.value = null;
}

function deleteEditingLabel() {
  if (editingLabelID.value) {
    props.labelsStore.deleteLabel(editingLabelID.value);
  }
  stopEditing(false);
}
</script>

<template>
  <v-card class="pt-2">
    <v-card-subtitle>Labels</v-card-subtitle>
    <v-container>
      <editable-chip-list
        v-model="selectedLabel"
        :items="labels"
        item-key="id"
        item-title="name"
        create-label-text="New label"
        @create="createLabel"
      >
        <template #item-prepend="{ item }">
          <!-- dot-container class keeps overflowing name from squishing dot width  -->
          <div class="dot-container mr-3">
            <div class="color-dot" :style="{ background: item.color }" />
          </div>
        </template>
        <template #item-append="{ key }">
          <v-btn
            icon="mdi-pencil"
            size="small"
            density="compact"
            class="ml-auto mr-1"
            variant="plain"
            @click.stop="startEditing(key as string)"
            data-testid="edit-label-button"
          />
        </template>
      </editable-chip-list>
    </v-container>
  </v-card>

  <isolated-dialog v-model="editDialog" max-width="800px">
    <tool-label-editor
      v-if="editingLabelID"
      v-model:name="editState.labelName"
      v-model:stroke-width="editState.strokeWidth"
      v-model:color="editState.color"
      @delete="deleteEditingLabel"
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
}
.dot-container {
  width: 18px;
}
</style>
