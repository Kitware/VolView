<script lang="ts">
import { defineComponent, reactive, computed } from 'vue';
import ImageListCard from '@/src/components/ImageListCard.vue';
import {
  appRestoreProcessors,
  convertSuccessResultToDataSelection,
  importDataSources,
} from '@/src/io/import/importDataSources';
import { remoteFileToDataSource } from '@/src/io/import/dataSource';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { SAMPLE_DATA } from '@/src/config';
import { useMessageStore } from '@/src/store/messages';
import { SampleDataset } from '@/src/types';
import { useImageStore } from '@/src/store/datasets-images';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { fetchFile } from '@/src/utils/fetch';
import { useSegmentStore } from '@/src/segmentation/segments';
import type { DataSource } from '@/src/io/import/dataSource';
import {
  showImportedData,
  urlsToDataSources,
} from '@/src/actions/loadUserFiles';

async function getSampleDataSources(
  sample: SampleDataset,
  progress: (percent: number) => void
) {
  if ('urls' in sample) return urlsToDataSources(sample.urls);

  const file = await fetchFile(sample.url, sample.filename, { progress });
  return [remoteFileToDataSource(file, sample.url)];
}

async function importSampleData(files: DataSource[], sample: SampleDataset) {
  return useSegmentStore().withDeferredImageInitialization(
    async (reserveImage) => {
      const loadResults = await importDataSources(files, {
        ...appRestoreProcessors(),
        onImageImported: reserveImage,
      });
      const errors = loadResults.flatMap((result) =>
        result.type === 'error' ? [result.error] : []
      );
      if (errors.length) {
        throw new Error(errors.map((error) => error.message).join('\n'));
      }
      const selections = loadResults.flatMap((result) => {
        const id = convertSuccessResultToDataSelection(result);
        return id ? [id] : [];
      });
      if (!selections.length) throw new Error('Did not receive a load result');

      if (sample.defaults?.colorPreset) {
        selections.forEach((selection) => {
          useVolumeColoringStore().setDefaults(selection, {
            transferFunction: { preset: sample.defaults?.colorPreset },
          });
        });
      }
      await showImportedData(loadResults);
      return selections;
    }
  );
}

export default defineComponent({
  components: {
    ImageListCard,
  },
  setup() {
    const status = reactive<{ progress: Record<string, number> }>({
      progress: {},
    });

    const loaded = reactive<{
      nameToIDs: Record<string, string[]>;
      idToName: Record<string, string>;
    }>({
      nameToIDs: {},
      idToName: {},
    });

    const clearLoadedStatus = (id: string) => {
      const name = loaded.idToName[id];
      if (name) {
        loaded.nameToIDs[name].forEach((memberID) => {
          delete loaded.idToName[memberID];
        });
        delete loaded.nameToIDs[name];
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
      if (sample.name in status.progress) return;
      const progress = (percent: number) => {
        status.progress[sample.name] = percent * 100;
      };
      try {
        progress(Infinity);
        const files = await getSampleDataSources(sample, progress);
        const selections = await importSampleData(files, sample);
        loaded.nameToIDs[sample.name] = selections;
        selections.forEach((id) => {
          loaded.idToName[id] = sample.name;
        });
      } catch (error) {
        const messageStore = useMessageStore();
        messageStore.addError('Failed to load sample data', {
          error: error as Error,
        });
      } finally {
        delete status.progress[sample.name];
      }
    }

    const samples = computed(() =>
      SAMPLE_DATA.map((sample) => {
        const isDownloading = sample.name in status.progress;
        const isLoaded = !!loaded.nameToIDs[sample.name];
        const progress = isDownloading
          ? Math.floor(status.progress[sample.name])
          : isLoaded
            ? 100
            : 0;
        return {
          ...sample,
          isDownloading,
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
  <div data-testid="samples-list">
    <image-list-card
      v-for="sample in samples"
      :disabled="
        sample.isDownloading || (sample.isLoaded && !('urls' in sample))
      "
      :key="sample.name"
      :html-title="sample.name"
      :image-url="sample.image"
      :image-size="100"
      class="mb-1"
      @click="downloadSample(sample)"
    >
      <div class="text-body-2 font-weight-bold text-no-wrap text-truncate">
        {{ sample.name }}
      </div>
      <div class="text-body-2 mt-2">{{ sample.description }}</div>
      <template #image-overlay v-if="sample.isDownloading || sample.isLoaded">
        <v-row class="fill-height ma-0 align-center justify-center">
          <v-progress-circular
            class="sample-progress"
            color="white"
            :indeterminate="sample.indeterminate"
            :model-value="sample.progress"
          >
            <v-icon
              v-if="sample.isLoaded && !sample.isDownloading"
              small
              color="white"
            >
              mdi-check
            </v-icon>
            <span
              v-else-if="!sample.indeterminate"
              class="text-caption text--white"
            >
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

<style scoped>
.sample-progress {
  background: rgba(0, 0, 0, 0.75);
  border-radius: 16px;
  box-shadow: 0 0 8px 8px rgba(0, 0, 0, 0.75);
}
</style>
