<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { LabelsStore } from '@/src/store/tools/useLabels';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import { Maybe } from '@/src/types';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import LabelEditor from './LabelEditor.vue';

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

const editingLabel =
  ref<Maybe<keyof typeof props.labelsStore.labels>>(undefined);

const createLabel = () => {
  editingLabel.value = props.labelsStore.addLabel();
};

const editDialog = ref(false);
watchEffect(() => {
  editDialog.value = !!editingLabel.value;
});
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
                  @click.stop="
                    () => {
                      editingLabel = id;
                      editDialog = true;
                    }
                  "
                  data-testid="edit-label-button"
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

  <closeable-dialog v-model="editDialog">
    <template v-slot="{ close }">
      <LabelEditor
        @done="
          editingLabel = undefined;
          close();
        "
        v-if="editingLabel"
        :label="editingLabel"
        :labelsStore="labelsStore"
      />
    </template>
  </closeable-dialog>
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
