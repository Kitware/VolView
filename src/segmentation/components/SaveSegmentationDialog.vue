<template>
  <v-card ref="card">
    <v-card-title class="d-flex flex-row align-center">
      Save Segments
    </v-card-title>
    <v-card-text>
      <v-form v-model="valid" @submit.prevent>
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
  computed,
  onMounted,
  ref,
  useTemplateRef,
  type ComponentPublicInstance,
} from 'vue';
import { onKeyDown } from '@vueuse/core';
import { planLabelmapExport } from '@/src/segmentation/io/composition';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  archiveNameFor,
  segmentationFileStem,
} from '@/src/segmentation/io/export';
import { saveLabelmapExport } from '@/src/segmentation/components/saveLabelmapExport';
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

const props = withDefaults(
  defineProps<{
    id: string;
    // Spelled out: `typeof` an import compiles to an untyped prop, whose
    // function default Vue would call as a factory.
    save?: (parentId: string, stem: string, format: string) => Promise<void>;
  }>(),
  { save: saveLabelmapExport }
);

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

async function saveSegmentation() {
  // Enter on the focused Save button fires the key handler and then the click.
  if (saving.value) return;
  if (fileName.value.trim().length === 0) {
    return;
  }

  saving.value = true;
  await useErrorMessage('Failed to save segments', async () => {
    const sanitizedFileName = sanitizeSegmentationFileStem(fileName.value);
    fileNameValue.value = sanitizedFileName;
    await props.save(parentImageId.value, sanitizedFileName, fileFormat.value);
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

// Card-scoped, so Enter in the teleported format menu never lands here; an Enter
// a control already consumed, such as the format select opening, is not a save.
const card = useTemplateRef<ComponentPublicInstance>('card');
onKeyDown(
  'Enter',
  (event) => {
    if (!event.defaultPrevented) saveSegmentation();
  },
  { target: () => card.value?.$el }
);

function validFileName(name: string) {
  return name.trim().length > 0 || 'Required';
}
</script>
