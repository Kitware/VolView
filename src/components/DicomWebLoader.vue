<script lang="ts">
import { defineComponent, ref, Ref } from '@vue/composition-api';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '../store/datasets';
import { fetchDicomWeb } from '../utils';
import { useMessageStore } from '../store/messages';

export default defineComponent({
  setup() {
    const datasetStore = useDatasetStore();
    const dicomWebServer: Ref<string> = ref('http://localhost:5173/dicom-web');
    const studyInstanceUID: Ref<string> = ref(
      '1.3.6.1.4.1.14519.5.2.1.2744.7002.271803936741289691489150315969'
    );
    const seriesInstanceUID: Ref<string> = ref(
      '1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256'
    );
    const sopInstanceUID: Ref<string> = ref(
      '1.3.6.1.4.1.14519.5.2.1.2744.7002.325971588264730726076978589153'
    );

    async function downloadDicom() {
      try {
        const loadedFile = await fetchDicomWeb(dicomWebServer.value, {
          studyInstanceUID: studyInstanceUID.value,
          seriesInstanceUID: seriesInstanceUID.value,
          sopInstanceUID: sopInstanceUID.value,
        });

        if (loadedFile) {
          const [loadResult] = await datasetStore.loadFiles([loadedFile]);
          if (loadResult?.loaded) {
            const selection = convertSuccessResultToDataSelection(loadResult);
            datasetStore.setPrimarySelection(selection);
          }
        } else {
          throw new Error('Fetch came back falsy.')
        }
      } catch (error) {
        const messageStore = useMessageStore();
        messageStore.addError('Failed to load sample data', error as Error);
      }
    }

    return {
      downloadDicom,
      dicomWebServer,
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID
    };
  },
});
</script>

<template>
  <div>
    <label for="dicomWebServer" class="label">DICOMWeb Server
      <input v-model="dicomWebServer" id="dicomWebServer" class="server-param" />
    </label>
    <label for="studyInstanceUID" class="label">Study Instance UID
      <input v-model="studyInstanceUID" id="studyInstanceUID" class="server-param" />
    </label>
    <label for="seriesInstanceUID" class="label">Series Instance UID
      <input v-model="seriesInstanceUID" id="seriesInstanceUID" class="server-param" />
    </label>
    <label for="sopInstanceUID" class="label">SOP Instance UID
      <input v-model="sopInstanceUID" id="sopInstanceUID" class="server-param" />
    </label>
    <button @click="downloadDicom()" class="load-button">Load</button>
  </div>
</template>

<style>
.server-param {
  width: 100%;
  color: white;
}

.label {
  color: rgba(255, 255, 255, 0.7);
}

.load-button {
  margin-top: 1em;
  padding: .5em;
  border: 1px solid rgba(255, 255, 255, 0.7);
}
</style>
