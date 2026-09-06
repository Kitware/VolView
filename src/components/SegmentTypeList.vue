<script setup lang="ts">
import { computed } from 'vue';
import EditableChipList from '@/src/components/EditableChipList.vue';
import IsolatedDialog from '@/src/components/IsolatedDialog.vue';
import SegmentTypeEditor from '@/src/components/SegmentTypeEditor.vue';
import { useSegmentTypeEditing } from '@/src/composables/useSegmentTypeEditing';
import type { SegmentTypeRegistry } from '@/src/store/tools/segmentTypeRegistry';
import { Maybe } from '@/src/types';
import { NO_NAME } from '@/src/constants';

const props = defineProps<{ registry: SegmentTypeRegistry }>();

const types = computed(() =>
  props.registry.typeList.value.map((type) => {
    const appearance = props.registry.appearanceOf(type.id);
    return {
      id: type.id,
      name: appearance.name || NO_NAME,
      color: appearance.cssColor,
    };
  })
);

const selectedType = computed({
  get: () => props.registry.selectedTypeId.value,
  set: (id: Maybe<string>) => {
    if (id != null) props.registry.selectType(id);
  },
});

const createType = () => {
  editing.editingTypeId.value = props.registry.addType();
};

const editing = useSegmentTypeEditing(() => props.registry);
const { editDialog, editState, editingType, editingName, invalidNames } =
  editing;
</script>

<template>
  <v-card class="pt-2" data-testid="tool-label-list">
    <v-card-subtitle>Labels</v-card-subtitle>
    <v-container>
      <editable-chip-list
        v-model="selectedType"
        :items="types"
        item-key="id"
        item-title="name"
        create-label-text="New label"
        @create="createType"
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
            @click.stop="editing.startEditing(key as string)"
            data-testid="edit-label-button"
          />
        </template>
      </editable-chip-list>
    </v-container>
  </v-card>

  <isolated-dialog v-model="editDialog" max-width="800px">
    <segment-type-editor
      v-if="editingType"
      v-model:name="editState.name"
      :original="editingName"
      v-model:color="editState.color"
      v-model:fill-opacity="editState.fillOpacity"
      v-model:outline-opacity="editState.outlineOpacity"
      v-model:stroke-width="editState.strokeWidth"
      @delete="editing.deleteEditingType()"
      @cancel="editing.stopEditing(false)"
      @done="editing.stopEditing(true)"
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
