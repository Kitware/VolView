<script lang="ts">
import {
  set,
  del,
  defineComponent,
  reactive,
  computed,
} from '@vue/composition-api';
import ImageListCard from '@/src/components/ImageListCard.vue';
import { useDatasetStore } from '@/src/store/datasets';
import {
  convertSuccessResultToDataSelection,
  importDataSources,
} from '@/src/io/import/importDataSources';
import { remoteFileToDataSource } from '@/src/io/import/dataSource';
import { SAMPLE_DATA } from '../config';
import { useMessageStore } from '../store/messages';
import { SampleDataset } from '../types';
import { useImageStore } from '../store/datasets-images';
import { useDICOMStore } from '../store/datasets-dicom';
import { fetchFile } from '../utils/fetch';

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

export default defineComponent({
  components: {
    ImageListCard,
  },
  setup() {
    const datasetStore = useDatasetStore();
    const status = reactive<{ progress: Progress }>({
      progress: {},
    });
    // URL -> data ID
    const loaded = reactive<{
      urlToID: Record<string, string>;
      idToURL: Record<string, string>;
    }>({
      urlToID: {},
      idToURL: {},
    });

    const clearLoadedStatus = (id: string) => {
      const url = loaded.idToURL[id];
      if (url) {
        del(loaded.idToURL, id);
        del(loaded.urlToID, url);
      }
    };

    const imageStore = useImageStore();
    imageStore.$onAction(({ name, args, after }) => {
      if (name === 'deleteData') {
        after(() => {
          const [id] = args;
          clearLoadedStatus(id as string);
        });
      }
    });

    const dicomStore = useDICOMStore();
    dicomStore.$onAction(({ name, args, after }) => {
      if (name === 'deleteVolume') {
        after(() => {
          const [key] = args;
          clearLoadedStatus(key as string);
        });
      }
    });

    async function downloadSample(sample: SampleDataset) {
      const progress = (percent: number) => {
        // TODO set/del doesn't exist in vue 3
        set(status.progress, sample.name, {
          state: ProgressState.Pending,
          progress: percent * 100,
        });
      };
      try {
        progress(Infinity);

        const sampleFile = await fetchFile(sample.url, sample.filename, {
          progress,
        });
        status.progress[sample.name].state = ProgressState.Done;

        const [loadResult] = await importDataSources([
          remoteFileToDataSource(sampleFile, sample.url),
        ]);

        if (!loadResult) {
          throw new Error('Did not receive a load result');
        }
        if (!loadResult.ok) {
          throw loadResult.errors[0].cause;
        }

        const selection = convertSuccessResultToDataSelection(loadResult);
        if (selection) {
          const id =
            selection.type === 'image' ? selection.dataID : selection.volumeKey;
          set(loaded.idToURL, id, sample.url);
          set(loaded.urlToID, sample.url, id);
        }
        datasetStore.setPrimarySelection(selection);
      } catch (error) {
        status.progress[sample.name].state = ProgressState.Error;
        const messageStore = useMessageStore();
        messageStore.addError('Failed to load sample data', error as Error);
      } finally {
        del(status.progress, sample.name);
      }
    }

    const samples = computed(() =>
      SAMPLE_DATA.map((sample) => {
        const isDone =
          status.progress[sample.name]?.state === ProgressState.Done;
        const isError =
          status.progress[sample.name]?.state === ProgressState.Error;
        const isLoaded = !!loaded.urlToID[sample.url];
        const progress =
          isDone || isLoaded
            ? 100
            : Math.floor(status.progress[sample.name]?.progress);
        return {
          ...sample,
          isDownloading: sample.name in status.progress,
          isDone,
          isError,
          isLoaded,
          indeterminate: progress === Infinity,
          progress,
        };
      })
    );

    return {
      samples,
      downloadSample,
    };
  },
});
</script>

<template>
  <div>
    <image-list-card
      v-for="sample in samples"
      :disabled="sample.isDownloading || sample.isLoaded"
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
      <template
        v-slot:image-overlay
        v-if="sample.isDownloading || sample.isLoaded"
      >
        <v-row class="fill-height ma-0" align="center" justify="center">
          <v-progress-circular
            color="white"
            :indeterminate="sample.indeterminate && !sample.isDone"
            :value="sample.progress"
          >
            <v-icon v-if="sample.isDone || sample.isLoaded" small color="white"
              >mdi-check</v-icon
            >
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
