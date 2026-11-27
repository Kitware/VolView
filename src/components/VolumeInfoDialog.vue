<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { listDataset } from '@/src/dicom/core/metadata/datasetListing';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import { useDataBrowserStore } from '@/src/store/data-browser';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';

const browser = useDataBrowserStore();
const cache = useImageCacheStore();
const dicomStore = useDICOMStore();

const imageID = computed(() => browser.infoImageID);
const image = computed(() =>
  imageID.value ? cache.imageById[imageID.value] : undefined
);
const close = () => {
  browser.infoImageID = null;
};
watch(image, (current) => {
  if (!current) close();
});

const metadata = computed(() => cache.getImageMetadata(imageID.value));

const format = (value: number) => Number(value.toPrecision(7)).toString();
const triple = (values: ArrayLike<number>) =>
  Array.from(values, format).join(', ');
const AXES = ['X', 'Y', 'Z'] as const;

const dicomRows = computed(() => {
  const id = imageID.value;
  const volume = id ? dicomStore.volumeInfo[id] : undefined;
  if (!id || !volume) return [];
  const study = dicomStore.studyInfo[dicomStore.volumeStudy[id]];
  const patient =
    dicomStore.patientInfo[dicomStore.studyPatient[dicomStore.volumeStudy[id]]];
  return [
    ['Patient ID', patient?.PatientID],
    ['Study ID', study?.StudyID],
    ['Study date', study?.StudyDate],
    ['Study description', study?.StudyDescription],
    ['Series number', volume.SeriesNumber],
    ['Series description', volume.SeriesDescription],
    ['Scan', volume.splitLabel],
    ['Modality', volume.Modality],
    [volume.kind === 'cine' ? 'Frames' : 'Slices', volume.NumberOfSlices],
  ].filter(([, value]) => value !== undefined && value !== '');
});

const geometryRows = computed(() => {
  const meta = metadata.value;
  if (!meta) return [];
  return [
    ['Dimensions', triple(meta.dimensions)],
    ['Origin', triple(meta.origin)],
    ...AXES.map((axis, index) => [
      `${axis} direction`,
      triple(meta.orientation.slice(index * 3, index * 3 + 3)),
    ]),
  ];
});

const spacingRows = computed(() => {
  const meta = metadata.value;
  if (!meta) return [];
  return AXES.map((label, index) => ({
    label,
    step: format(meta.spacing[index]),
    singleton: meta.dimensions[index] === 1,
  }));
});

const firstInstance = computed(() => image.value?.getInstances()[0]);
const allTagRows = computed(() =>
  firstInstance.value ? listDataset(firstInstance.value.dataset) : []
);
// The field's clear button sets null.
const tagFilter = ref<string | null>('');
watch(imageID, () => {
  tagFilter.value = '';
});
const tagRows = computed(() => {
  const needle = (tagFilter.value ?? '').trim().toLowerCase();
  const rows = allTagRows.value;
  if (!needle) return rows;
  return rows.filter((row) =>
    [row.tag, row.name, row.value].some((text) =>
      text.toLowerCase().includes(needle)
    )
  );
});
</script>

<template>
  <closeable-dialog
    :model-value="!!image"
    max-width="760px"
    scrollable
    @update:model-value="!$event && close()"
  >
    <v-card v-if="metadata" data-testid="volume-info">
      <v-card-title class="text-truncate info-text pr-14">{{
        metadata.name
      }}</v-card-title>
      <v-card-text class="info-text">
        <template v-if="dicomRows.length">
          <div class="text-subtitle-1 font-weight-bold">Patient and study</div>
          <v-table density="compact" class="mb-4">
            <tbody>
              <tr
                v-for="[label, value] in dicomRows"
                :key="label"
                :data-testid="`volume-info-${label}`"
              >
                <td class="label">{{ label }}</td>
                <td>{{ value }}</td>
              </tr>
            </tbody>
          </v-table>
        </template>

        <div class="text-subtitle-1 font-weight-bold">Geometry</div>
        <v-table density="compact" class="mb-4">
          <tbody>
            <tr
              v-for="[label, value] in geometryRows"
              :key="label"
              :data-testid="`volume-info-${label}`"
            >
              <td class="label">{{ label }}</td>
              <td>{{ value }}</td>
            </tr>
          </tbody>
        </v-table>

        <div class="text-subtitle-1 font-weight-bold">Spacing</div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Axis</th>
              <th>Step</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in spacingRows"
              :key="row.label"
              :data-testid="`spacing-axis-${row.label}`"
            >
              <td>
                {{ row.label }}
                <div v-if="row.singleton" class="text-caption">One sample</div>
              </td>
              <td>{{ row.step }}</td>
            </tr>
          </tbody>
        </v-table>

        <v-expansion-panels v-if="firstInstance" class="mt-4">
          <v-expansion-panel data-testid="volume-info-tags">
            <v-expansion-panel-title>
              DICOM tags of the first instance
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <p class="mb-2">
                Transfer syntax:
                {{ firstInstance.transferSyntaxUid ?? 'Unknown' }}. Private tags
                are not read.
              </p>
              <v-text-field
                v-model="tagFilter"
                label="Filter tags"
                density="compact"
                hide-details
                clearable
                class="mb-2"
              />
              <v-table density="compact" class="tags">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Name</th>
                    <th>VR</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, index) in tagRows"
                    :key="index"
                    data-testid="volume-info-tag"
                  >
                    <td class="text-no-wrap">
                      <span :style="{ paddingLeft: `${row.depth}em` }">
                        {{ row.tag }}
                      </span>
                    </td>
                    <td>{{ row.name }}</td>
                    <td>{{ row.vr }}</td>
                    <td class="value">{{ row.value }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>
  </closeable-dialog>
</template>

<style scoped>
.info-text {
  user-select: text;
}

.label {
  width: 40%;
}

.tags .value {
  word-break: break-all;
}
</style>
