<template>
  <v-card ref="card">
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
import {
  captureLabelmapParts,
  composeLabelmapPart,
  planLabelmapExport,
} from '@/src/segmentation/io/composition';

import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  computed,
  onMounted,
  ref,
  useTemplateRef,
  type ComponentPublicInstance,
} from 'vue';
import { onKeyDown } from '@vueuse/core';
import { saveAs } from 'file-saver';
import { useSegmentationStore } from '@/src/segmentation/store';
import { writeSegmentation } from '@/src/io/readWriteImage';
import {
  archiveNameFor,
  bundleExportFiles,
  layerFileName,
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
  const format = fileFormat.value;
  const parentId = parentImageId.value;
  const snapshot = captureLabelmapParts(
    parentId,
    planLabelmapExport(parentId).parts
  );
  const files: ExportFile[] = [];
  // Written one at a time: serializing copies the whole buffer, and itk-wasm
  // queues the writes on one shared worker whatever the caller does.
  for (const [index, members] of snapshot.parts.entries()) {
    const composite = composeLabelmapPart(snapshot.parent, members);
    const data = await writeSegmentation(
      format,
      composite.labelmap,
      composite.segments
    );
    files.push({ name: layerFileName(stem, format, index), data });
  }
  return files;
}

async function saveSegmentation() {
  // One keystroke can arrive twice -- the form submits and the key handler
  // below fires -- and a write in flight must not be joined by a second one
  // composing the same masks into a second download.
  if (saving.value) return;
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
  fileNameValue.value = sanitizeSegmentationFileStem(segmentation.value.name);
});

// Enter saves, but only when it belongs to this dialog: the listener sits on
// the card rather than on the window, so a keystroke aimed at an overlay above
// it, such as the format menu, chooses an option instead of starting a save.
const card = useTemplateRef<ComponentPublicInstance>('card');
onKeyDown('Enter', () => saveSegmentation(), {
  target: () => card.value?.$el,
});

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
