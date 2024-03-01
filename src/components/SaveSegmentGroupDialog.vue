<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Save Segment Group
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSegmentGroup">
        <v-text-field
          v-model="fileName"
          hint="Filename that will appear in downloads."
          label="Filename"
          :rules="[validFileName]"
          required
          id="filename"
        />

        <v-select
          label="Format"
          v-model="fileFormat"
          :items="EXTENSIONS"
        ></v-select>
      </v-form>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        :loading="saving"
        color="secondary"
        @click="saveSegmentGroup"
        :disabled="!valid"
      >
        <v-icon class="mr-2">mdi-content-save</v-icon>
        <span data-testid="save-confirm-button">Save</span>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { onKeyDown } from '@vueuse/core';
import { saveAs } from 'file-saver';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { writeImage } from '@/src/io/readWriteImage';
import { useErrorMessage } from '@/src/composables/useErrorMessage';

const EXTENSIONS = [
  'nrrd',
  'nii',
  'nii.gz',
  'dcm',
  'hdf5',
  'tif',
  'mha',
  'vtk',
  'iwi.cbor',
];

const props = defineProps<{
  id: string;
}>();

const emit = defineEmits(['done']);

const fileName = ref('');
const valid = ref(true);
const saving = ref(false);
const fileFormat = ref(EXTENSIONS[0]);

const segmentGroupStore = useSegmentGroupStore();

async function saveSegmentGroup() {
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segment group', async () => {
    const image = segmentGroupStore.dataIndex[props.id];
    const serialized = await writeImage(fileFormat.value, image);
    saveAs(new Blob([serialized]), `${fileName.value}.${fileFormat.value}`);
  });
  saving.value = false;
  emit('done');
}

onMounted(() => {
  // trigger form validation check so can immediately save with default value
  fileName.value = segmentGroupStore.metadataByID[props.id].name;
});

onKeyDown('Enter', () => {
  saveSegmentGroup();
});

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
