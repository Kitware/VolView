<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Save Segments
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSegmentation">
        <v-text-field
          v-model="fileName"
          hint="Filename used for downloads."
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

        <v-alert
          v-if="plan.parts.length > 1"
          type="info"
          variant="tonal"
          density="compact"
          data-testid="save-overlap-notice"
        >
          Saving {{ plan.parts.length }} files due to {{ splitReason }}, bundled
          into {{ archiveName }}.
        </v-alert>
      </v-form>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        :loading="saving"
        color="secondary"
        @click="saveSegmentation"
        :disabled="!valid"
      >
        <v-icon class="mr-2">mdi-content-save</v-icon>
        <span data-testid="save-confirm-button">Save</span>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { planLabelmapExport } from '@/src/segmentation/io/composition';

import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import { computed, onMounted, ref } from 'vue';
import { onKeyDown } from '@vueuse/core';
import { saveAs } from 'file-saver';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  archiveNameFor,
  bundleExportFiles,
  segmentationFileStem,
  writeLabelmapParts,
  type ExportFile,
} from '@/src/segmentation/io/export';
import { useErrorMessage } from '@/src/composables/useErrorMessage';
import { sanitizeSegmentationFileStem } from '@/src/io/state-file/maskArchivePath';

const EXTENSIONS = [
  'seg.nrrd',
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

const emit = defineEmits<{ done: [] }>();

const fileNameValue = ref('');
const valid = ref(true);
const saving = ref(false);
const fileFormat = ref(EXTENSIONS[0]);

const segmentationStore = useSegmentationStore();
const segmentation = computed(() => segmentationStore.segmentations[props.id]);
const parentImageId = computed(() => segmentation.value.parentImageId);
const fileName = computed({
  get: () => fileNameValue.value,
  set: (value: string) => {
    fileNameValue.value = sanitizeSegmentationFileStem(value, '');
  },
});

const plan = computed(() => planLabelmapExport(parentImageId.value));
const splitReason = computed(() =>
  [
    plan.value.hasOverlap && 'overlap',
    plan.value.exceedsCapacity && 'the label-value limit',
  ]
    .filter(Boolean)
    .join(' and ')
);
// Named by the same function the download uses, so the notice cannot promise
// an archive the save does not write.
const archiveName = computed(() =>
  archiveNameFor(sanitizeSegmentationFileStem(fileName.value))
);

// What leaves VolView is the image's whole segmentation, not one segment's
// bounded mask, so the masks are composited on the way out. One file carries
// one label per voxel, so each group of segments that do not overlap makes its
// own file.
async function writeParts(stem: string) {
  useSegmentationEditsStore().beforeRead();
  const parentId = parentImageId.value;
  const files: ExportFile[] = [];
  await writeLabelmapParts(
    { parentId, parts: planLabelmapExport(parentId).parts },
    stem,
    fileFormat.value,
    (file) => {
      files.push(file);
    }
  );
  return files;
}

async function saveSegmentation() {
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segments', async () => {
    const sanitizedFileName = sanitizeSegmentationFileStem(fileName.value);
    fileNameValue.value = sanitizedFileName;
    const files = await writeParts(sanitizedFileName);
    const bundle = await bundleExportFiles(sanitizedFileName, files);
    saveAs(bundle.blob, bundle.name);
  });
  saving.value = false;
  emit('done');
}

onMounted(() => {
  // trigger form validation check so can immediately save with default value
  fileNameValue.value = segmentationFileStem(
    parentImageId.value,
    segmentation.value.name
  );
});

onKeyDown('Enter', () => {
  saveSegmentation();
});

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
