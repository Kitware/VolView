<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import { Maybe } from '@/src/types';
import ToolLabelEditor from '@/src/components/ToolLabelEditor.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';

const props = defineProps<{
  labelsStore: LabelsStore<AnnotationTool>;
}>();

const labels = computed(() => Object.entries(props.labelsStore.labels));
// item groups need an index, not a value
const activeLabelIndex = computed(() => {
  return labels.value.findIndex(
    ([name]) => name === props.labelsStore.activeLabel
  );
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

const createLabel = () => {
  editingLabelID.value = props.labelsStore.addLabel();
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
      <v-item-group
        :model-value="activeLabelIndex"
        selected-class="card-active"
        mandatory
      >
        <v-row dense>
          <v-col
            cols="6"
            v-for="[id, { labelName, color }] in labels"
            :key="id"
          >
            <v-item v-slot="{ selectedClass, toggle }">
              <v-chip
                variant="tonal"
                :class="['w-100 d-flex', selectedClass]"
                @click="
                  () => {
                    toggle();
                    labelsStore.setActiveLabel(id);
                  }
                "
              >
                <!-- dot container keeps overflowing name from squishing dot width  -->
                <div class="dot-container mr-3">
                  <div class="color-dot" :style="{ background: color }" />
                </div>
                <span class="overflow-hidden">{{ labelName }}</span>
                <v-btn
                  icon="mdi-pencil"
                  density="compact"
                  class="ml-auto"
                  variant="plain"
                  @click.stop="startEditing(id)"
                />
              </v-chip>
            </v-item>
          </v-col>

          <!-- Add Label button -->
          <v-col cols="6">
            <v-chip variant="outlined" class="w-100" @click="createLabel">
              <v-icon class="mr-2">mdi-plus</v-icon>
              Add Label
            </v-chip>
          </v-col>
        </v-row>
      </v-item-group>
    </v-container>
  </v-card>

  <isolated-dialog v-model="editDialog">
    <ToolLabelEditor
      v-if="editingLabelID"
      v-model:name="editState.labelName"
      v-model:stroke-width="editState.strokeWidth"
      v-model:color="editState.color"
      @delete="deleteEditingLabel"
      @cancel="stopEditing(false)"
      @done="stopEditing(true)"
    />
  </isolated-dialog>
</template>

<style scoped>
.card-active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.color-dot {
  width: 18px;
  height: 18px;
  border-radius: 16px;
}
.dot-container {
  width: 18px;
}
</style>
