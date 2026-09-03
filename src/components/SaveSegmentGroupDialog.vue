<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Save Segments
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent="saveSegmentGroup">
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
          v-if="groups.length > 1"
          type="info"
          variant="tonal"
          density="compact"
          data-testid="save-overlap-notice"
        >
          Segments that overlap cannot share one file. Saving writes
          {{ groups.length }} files, bundled into {{ archiveName }}.
        </v-alert>
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
import { computed, onMounted, ref } from 'vue';
import { onKeyDown } from '@vueuse/core';
import { saveAs } from 'file-saver';
import { useSegmentationStore } from '@/src/store/segmentations';
import { writeSegmentation } from '@/src/io/readWriteImage';
import {
  archiveNameFor,
  bundleExportFiles,
  layerFileName,
  type ExportFile,
} from '@/src/io/segmentationExport';
import { useErrorMessage } from '@/src/composables/useErrorMessage';
import { sanitizeSegmentGroupFileStem } from '@/src/io/state-file/segmentGroupArchivePath';

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

const emit = defineEmits(['done']);

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
    fileNameValue.value = sanitizeSegmentGroupFileStem(value, '');
  },
});

const groups = computed(() =>
  segmentationStore.layeredSegments(parentImageId.value)
);
// Named by the same function the download uses, so the notice cannot promise
// an archive the save does not write.
const archiveName = computed(() =>
  archiveNameFor(sanitizeSegmentGroupFileStem(fileName.value))
);

// What leaves VolView is the image's whole segmentation, not one segment's
// bounded mask, so the masks are composited on the way out. One file carries
// one label per voxel, so each group of segments that do not overlap makes its
// own file.
async function writeGroups(stem: string) {
  const format = fileFormat.value;
  const files: ExportFile[] = [];
  // Written one at a time: serializing copies the whole buffer, and itk-wasm
  // queues the writes on one shared worker whatever the caller does.
  for (const [index, members] of groups.value.entries()) {
    const composite = segmentationStore.compositeLabelmap(
      parentImageId.value,
      members
    );
    const data = await writeSegmentation(
      format,
      composite.labelmap,
      composite.segments
    );
    files.push({ name: layerFileName(stem, format, index), data });
  }
  return files;
}

async function saveSegmentGroup() {
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segments', async () => {
    const sanitizedFileName = sanitizeSegmentGroupFileStem(fileName.value);
    fileNameValue.value = sanitizedFileName;
    const files = await writeGroups(sanitizedFileName);
    const bundle = await bundleExportFiles(sanitizedFileName, files);
    saveAs(bundle.blob, bundle.name);
  });
  saving.value = false;
  emit('done');
}

onMounted(() => {
  // trigger form validation check so can immediately save with default value
  fileNameValue.value = sanitizeSegmentGroupFileStem(segmentation.value.name);
});

onKeyDown('Enter', () => {
  saveSegmentGroup();
});

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
