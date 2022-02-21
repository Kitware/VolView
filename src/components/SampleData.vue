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
import { useStore } from '../composables/store';

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
    const store = useStore();
    const inProgress = reactive({} as InProgress);

    function getBaseImages() {
      const { data } = store.state;
      return {
        images: [...data.imageIDs],
        dicom: [...data.dicomIDs],
      };
    }

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

        const baseImages = getBaseImages();
        await store.dispatch('loadFiles', [sampleFile]);

        const after = getBaseImages();
        let arr = null;
        if (baseImages.images.length < after.images.length) {
          arr = after.images;
        } else if (baseImages.dicom.length < after.dicom.length) {
          arr = after.dicom;
        }

        if (arr) {
          const last = arr[arr.length - 1];
          store.dispatch('selectBaseImage', last);
          store.dispatch('visualization/updateScene', { reset: true });
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
