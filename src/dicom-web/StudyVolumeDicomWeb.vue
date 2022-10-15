<script lang="ts">
import {
  computed,
  defineComponent,
  reactive,
  set,
  toRefs,
  watch,
} from '@vue/composition-api';
import type { PropType } from '@vue/composition-api';
import {
  convertSuccessResultToDataSelection,
  useDatasetStore,
} from '@/src/store/datasets';
import { useMessageStore } from '@/src/store/messages';
import { useDicomMetaStore } from './dicom-meta.store';
import { useDicomWebStore } from './dicom-web.store';

function dicomCacheKey(volKey: string) {
  return `dicom-${volKey}`;
}

export default defineComponent({
  name: 'StudyVolumeDicomWeb',
  props: {
    volumeKeys: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
  },
  components: {},
  setup(props) {
    const { volumeKeys } = toRefs(props);

    const dicomStore = useDicomMetaStore();
    const dicomWebStore = useDicomWebStore();

    const volumes = computed(() => {
      const { volumeInfo } = dicomStore;
      return volumeKeys.value.map((volumeKey) => ({
        key: volumeKey,
        // for thumbnailing
        cacheKey: dicomCacheKey(volumeKey),
        info: volumeInfo[volumeKey],
      }));
    });

    // --- thumbnails --- //

    const thumbnailCache = reactive<Record<string, string>>({});

    watch(
      volumeKeys,
      (keys) => {
        keys.forEach(async (key) => {
          const cacheKey = dicomCacheKey(key);
          if (cacheKey in thumbnailCache) {
            return;
          }
          const thumb = await dicomWebStore.fetchVolumeThumbnail(key);
          if (thumb !== null) {
            set(thumbnailCache, cacheKey, thumb);
          }
        });
      },
      { immediate: true, deep: true }
    );

    const datasetStore = useDatasetStore();

    async function downloadDicom(volumeKey: string) {
      const volumeInfo = dicomStore.volumeInfo[volumeKey];
      const studyKey = dicomStore.volumeStudy[volumeKey];
      const studyInfo = dicomStore.studyInfo[studyKey];
      const seriesInfo = {
        studyInstanceUID: studyInfo.StudyInstanceUID,
        seriesInstanceUID: volumeInfo.SeriesInstanceUID,
      };
      try {
        const files = await dicomWebStore.fetchSeries(seriesInfo);
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
        messageStore.addError('Failed to load DICOM', error as Error);
      }
    }

    return {
      thumbnailCache,
      volumes,
      downloadDicom,
    };
  },
});
</script>

<template>
  <v-container class="pa-0">
    <v-row no-gutters>
      <v-col>
        <div class="my-2 volume-list">
          <v-container v-for="volume in volumes" :key="volume.info.VolumeID">
            <v-card
              outlined
              ripple
              :class="{
                'volume-card': true,
              }"
              min-height="180px"
              min-width="180px"
              :title="volume.info.SeriesDescription"
              @click="downloadDicom(volume.info.VolumeID)"
            >
              <v-row no-gutters class="pa-0" justify="center">
                <div>
                  <v-img
                    contain
                    max-height="150px"
                    max-width="150px"
                    :src="(thumbnailCache || {})[volume.cacheKey] || ''"
                  >
                    <v-overlay
                      absolute
                      class="thumbnail-overlay"
                      :value="true"
                      opacity="0"
                    >
                      <div class="d-flex flex-column fill-height">
                        <v-spacer />
                        <v-row no-gutters justify="start" align="end">
                          <div class="mb-1 ml-1 text-caption">
                            [{{ volume.info.NumberOfSlices }}]
                          </div>
                        </v-row>
                      </div>
                    </v-overlay>
                  </v-img>
                </div>
              </v-row>
              <v-card-text
                class="text--primary text-caption text-center series-desc mt-n3"
              >
                <div class="text-ellipsis">
                  {{ volume.info.SeriesDescription || '(no description)' }}
                </div>
              </v-card-text>
            </v-card>
          </v-container>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.volume-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  grid-auto-rows: 200px;
  justify-content: center;
}

.volume-card {
  padding: 8px;
  cursor: pointer;
}

.series-desc {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.thumbnail-overlay >>> .v-overlay__content {
  height: 100%;
  width: 100%;
}

.volume-list >>> .theme--light.v-sheet--outlined {
  border: none;
}
</style>
