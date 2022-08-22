<script lang="ts">
import {
  set,
  del,
  defineComponent,
  reactive,
  watch,
  ref,
} from '@vue/composition-api';
import ImageListCard from '@/src/components/ImageListCard.vue';
import { Sample, SAMPLE_DATA } from '../config';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '../store/datasets';
import { fetchFileWithProgress } from '../utils';
import { useMessageStore } from '../store/messages';

enum ProgressState {
  Pending,
  Error,
  Done,
}

interface Progress {
  [name: string]: {
    state: ProgressState;
    progress: number;
  };
}

interface RenderedSample extends Sample {
  isDownloading: boolean;
  isDone: boolean;
  isError: boolean;
  indeterminate: boolean;
  progress: number;
}

export default defineComponent({
  components: {
    ImageListCard,
  },
  setup() {
    const datasetStore = useDatasetStore();
    const inProgress = reactive({} as Progress);

    async function downloadSample(sample: Sample) {
      const progress = (percent: number) => {
        // TODO set/del doesn't exist in vue 3
        set(inProgress, sample.name, {
          state: ProgressState.Pending,
          progress: percent * 100,
        });
      };
      try {
        progress(Infinity);

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
          if (loadResult?.loaded) {
            const selection = convertSuccessResultToDataSelection(loadResult);
            datasetStore.setPrimarySelection(selection);
          }
        }
      } catch (error) {
        inProgress[sample.name].state = ProgressState.Error;
        const messageStore = useMessageStore();
        messageStore.addError('Failed to load sample data', error as Error);
      } finally {
        setTimeout(() => del(inProgress, sample.name), 2000);
      }
    }

    const samplesToRender = ref<RenderedSample[]>();

    watch(
      inProgress,
      () => {
        const samples: RenderedSample[] = [];
        SAMPLE_DATA.forEach((sample) => {
          const isDone = inProgress[sample.name]?.state === ProgressState.Done;
          const isError =
            inProgress[sample.name]?.state === ProgressState.Error;
          const progress = isDone
            ? 100
            : Math.floor(inProgress[sample.name]?.progress);
          samples.push({
            ...sample,
            isDownloading: sample.name in inProgress,
            isDone,
            isError,
            indeterminate: progress === Infinity,
            progress,
          });
        });

        samplesToRender.value = samples;
      },
      {
        immediate: true,
      }
    );

    return {
      samples: samplesToRender,
      downloadSample,
    };
  },
});
</script>

<template>
  <div>
    <image-list-card
      v-for="sample in samples"
      :disabled="sample.isDownloading"
      :key="sample.name"
      :title="sample.name"
      :image-url="sample.image"
      :image-size="100"
      @click="downloadSample(sample)"
    >
      <div class="body-2 font-weight-bold text-no-wrap text-truncate">
        {{ sample.name }}
      </div>
      <div class="body-2 mt-2">{{ sample.description }}</div>
      <template v-slot:image-overlay v-if="sample.isDownloading">
        <v-row class="fill-height ma-0" align="center" justify="center">
          <v-progress-circular
            color="white"
            :indeterminate="sample.indeterminate && !sample.isDone"
            :value="sample.progress"
          >
            <v-icon v-if="sample.isDone" small color="white">mdi-check</v-icon>
            <v-icon v-else-if="sample.isError" small color="white">
              mdi-alert-circle
            </v-icon>
            <span v-else-if="!sample.indeterminate" class="caption text--white">
              {{ sample.progress }}
            </span>
          </v-progress-circular>
        </v-row>
      </template>
    </image-list-card>
  </div>
</template>

<style>
/* The transition animation causes the progress bar to load slowly
   when the value is updated rapidly. */
.v-progress-circular__overlay {
  transition: unset;
}
</style>
