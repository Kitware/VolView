<template>
  <div id="samples-module" class="mx-2 height-100">
    <v-list>
      <v-list-item
        v-for="sample in SAMPLE_DATA"
        :key="sample.name"
        :disabled="sample.name in inProgress"
        @click="downloadSample(sample)"
      >
        <v-list-item-title>{{ sample.name }}</v-list-item-title>
        <template v-if="sample.name in inProgress">
          <span v-if="inProgress[sample.name].state === Pending">
            {{ inProgress[sample.name].progress.toFixed(2) }}
          </span>
          <span v-else-if="inProgress[sample.name].state === Error">
            Error
          </span>
          <span v-else-if="inProgress[sample.name].state === Done">Done</span>
        </template>
      </v-list-item>
    </v-list>
  </div>
</template>

<script lang="ts">
import { defineComponent, del, reactive, set } from '@vue/composition-api';

import { Sample, SAMPLE_DATA } from '@src/constants';
import { fetchFileWithProgress } from '@src/utils';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '@/src/store/datasets';

enum ProgressState {
  Pending,
  Error,
  Done,
}

interface InProgress {
  [name: string]: {
    state: ProgressState;
    progress: number;
  };
}

export default defineComponent({
  setup() {
    const datasetStore = useDatasetStore();
    const inProgress = reactive({} as InProgress);

    async function downloadSample(sample: Sample) {
      const progress = (percent: number) => {
        set(inProgress, sample.name, {
          state: ProgressState.Pending,
          progress: percent * 100,
        });
      };
      try {
        progress(0);

        const sampleFile = await fetchFileWithProgress(
          sample.url,
          sample.filename,
          progress,
          {
            mode: 'cors',
          }
        );
        inProgress[sample.name].state = ProgressState.Done;

        if (sampleFile) {
          const [loadResult] = await datasetStore.loadFiles([sampleFile]);
          if (loadResult.loaded) {
            const selection = convertSuccessResultToDataSelection(loadResult);
            datasetStore.setPrimarySelection(selection);
          }
        }
      } catch (error) {
        inProgress[sample.name].state = ProgressState.Error;
        console.error(error);
      } finally {
        setTimeout(() => del(inProgress, sample.name), 2000);
      }
    }
    return {
      SAMPLE_DATA,
      downloadSample,
      inProgress,
      Pending: ProgressState.Pending,
      Error: ProgressState.Error,
      Done: ProgressState.Done,
    };
  },
});
</script>
