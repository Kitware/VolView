<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import ImageListCard from '@/src/components/ImageListCard.vue';
import { useMessageStore } from '../store/messages';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '../store/datasets';
import { useDicomWebStore } from './dicom-web.store';
import { pick } from '../utils';
import { getSeries, GetSeriesOptions } from './dicomWeb';

export default defineComponent({
  components: {
    ImageListCard,
  },
  setup() {
    const dicomWeb = useDicomWebStore();

    const datasetStore = useDatasetStore();

    async function downloadDicom(options: GetSeriesOptions) {
      try {
        const files = await getSeries(
          dicomWeb.host,
          pick(options, 'seriesInstanceUID', 'studyInstanceUID')
        );
        if (files) {
          const [loadResult] = await datasetStore.loadFiles(files);
          if (loadResult?.loaded) {
            const selection = convertSuccessResultToDataSelection(loadResult);
            datasetStore.setPrimarySelection(selection);
          } else {
            throw new Error('Failed to load DICOM.');
          }
        } else {
          throw new Error('Fetch came back falsy.');
        }
      } catch (error) {
        const messageStore = useMessageStore();
        messageStore.addError('Failed to load sample data', error as Error);
      }
    }

    return {
      dicomWeb,
      downloadDicom,
    };
  },
});
</script>

<template>
  <v-container v-if="dicomWeb.dicoms.length > 0">
    <image-list-card
      v-for="dicom in dicomWeb.dicoms"
      :key="dicom.seriesInstanceUID"
      :title="dicom.seriesDescription"
      :image-url="dicom.thumbnailUrl"
      @click="downloadDicom(dicom)"
    >
      <div class="body-2 font-weight-bold text-no-wrap text-truncate">
        {{ dicom.seriesDescription }}
      </div>
      <div class="body-2 mt-2">{{ dicom.patientName }}</div>
      <div class="body-2 mt-2">{{ dicom.modality }}</div>
    </image-list-card>
  </v-container>
</template>

<style scoped></style>
