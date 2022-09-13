<script lang="ts">
import { defineComponent, ref, Ref } from '@vue/composition-api';
import ImageListCard from '@/src/components/ImageListCard.vue';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '../store/datasets';
import { GetSeriesOptions, getAllSeries, getSeries } from '../utils/dicomWeb';
import { useMessageStore } from '../store/messages';
import { pick } from '../utils';

export default defineComponent({
  components: {
    ImageListCard,
  },
  setup() {
    const datasetStore = useDatasetStore();
    const dicomWebServer: Ref<string> = ref('http://localhost:5173/dicom-web');

    async function downloadDicom(options: GetSeriesOptions) {
      try {
        const files = await getSeries(dicomWebServer.value,
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

    const dicoms: Ref<any[] | undefined> = ref();

    async function fetchDicomList() {
      dicoms.value = await getAllSeries(dicomWebServer.value)
    }

    return {
      downloadDicom,
      fetchDicomList,
      dicoms,
      dicomWebServer,
      pick
    };
  },
});
</script>

<template>
  <div>
    <label for="dicomWebServer" class="form-label">DICOMWeb Server Address
      <input v-model="dicomWebServer" id="dicomWebServer" class="server-param" />
    </label>
    <button @click="fetchDicomList()" class="login-button">Get DICOMS</button>
    <div v-if="dicoms && dicoms.length > 0">
      <image-list-card v-for="dicom in dicoms" :key="dicom.seriesInstanceUID" :title="dicom.seriesDescription"
        @click="downloadDicom(dicom)">
        <h4>
          {{dicom.seriesDescription}}
        </h4>
      </image-list-card>
    </div>
    <p v-if="dicoms && dicoms.length === 0">Found no DICOMS</p>
  </div>
</template>

<style scoped>
.server-param {
  width: 100%;
  color: white;
}

.form-label {
  color: rgba(255, 255, 255, 0.7);
}

.login-button {
  margin: 1em 0;
  padding: .5em;
  border: 1px solid rgba(255, 255, 255, 0.7);
}

.instance {
  margin: 1em;
}
</style>
