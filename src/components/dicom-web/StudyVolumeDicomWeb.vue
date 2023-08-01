<script lang="ts">
import { computed, defineComponent, reactive, ref, toRefs, watch } from 'vue';
import type { PropType } from 'vue';
import { useDicomMetaStore } from '../../store/dicom-web/dicom-meta-store';
import {
  useDicomWebStore,
  isDownloadable,
  VolumeProgress,
} from '../../store/dicom-web/dicom-web-store';
import { formatBytes } from '../../utils';
import PersistentOverlay from '../PersistentOverlay.vue';

const percentDone = (progress: VolumeProgress): number => {
  if (!progress || progress.total === 0) return 0;
  const { total, loaded } = progress;
  return Math.round((100 * loaded) / total);
};

export default defineComponent({
  name: 'StudyVolumeDicomWeb',
  props: {
    volumeKeys: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
  },
  components: { PersistentOverlay },
  setup(props) {
    const dicomStore = useDicomMetaStore();
    const dicomWebStore = useDicomWebStore();

    const { volumeKeys } = toRefs(props);

    // If deep linking for specific series, don't try to show other series initially, so filter.
    const volumeKeysWithInstanceMeta = computed(() => {
      const { volumeInstances, instanceInfo } = dicomStore;
      return volumeKeys.value.filter(
        (volumeKey) => instanceInfo[volumeInstances[volumeKey][0]]
      );
    });

    const isFetching = ref(true);
    dicomWebStore.fetchVolumesMeta(volumeKeys.value).then(() => {
      isFetching.value = false;
    });

    const volumes = computed(() => {
      if (isFetching.value) return [];

      const { volumeInfo, volumeInstances, instanceInfo } = dicomStore;
      return volumeKeysWithInstanceMeta.value.map((volumeKey) => {
        const { Rows: rows, Columns: columns } =
          instanceInfo[volumeInstances[volumeKey][0]];
        const info = volumeInfo[volumeKey];
        return {
          key: volumeKey,
          info,
          widthHeightFrames: `${columns} x ${rows} x ${info.NumberOfSlices}`,
          isDisabled: !isDownloadable(dicomWebStore.volumes[volumeKey]),
          progress: {
            ...dicomWebStore.volumes[volumeKey],
            percent: percentDone(dicomWebStore.volumes[volumeKey]),
          },
        };
      });
    });

    const thumbnailCache = reactive<Record<string, string>>({});

    watch(
      [volumeKeysWithInstanceMeta, isFetching],
      ([keys, guard]) => {
        if (guard) return;

        keys
          .filter((key) => !(key in thumbnailCache))
          .forEach(async (key) => {
            const thumb = await dicomWebStore.fetchVolumeThumbnail(key);
            if (thumb !== null) {
              thumbnailCache[key] = thumb;
            }
          });
      },
      { immediate: true, deep: true }
    );

    function downloadDicom(volumeKey: string) {
      dicomWebStore.downloadVolume(volumeKey);
    }

    return {
      thumbnailCache,
      volumes,
      downloadDicom,
      formatBytes,
      isFetching,
    };
  },
});
</script>

<template>
  <v-container class="pa-0">
    <v-row no-gutters>
      <v-col>
        <div class="my-2 volume-list">
          <v-progress-circular v-if="isFetching" class="fetching" indeterminate>
          </v-progress-circular>

          <v-card
            v-for="volume in volumes"
            :key="volume.info.VolumeID"
            variant="outlined"
            class="volume-card mt-1"
            min-height="180px"
            min-width="180px"
            :html-title="volume.info.SeriesDescription"
            :disabled="volume.isDisabled"
            :ripple="!volume.isDisabled"
            @click="downloadDicom(volume.info.VolumeID)"
          >
            <v-row no-gutters class="pa-0" justify="center">
              <div class="thumbnail-container">
                <v-img
                  cover
                  height="150"
                  width="150"
                  :src="(thumbnailCache || {})[volume.key] || ''"
                >
                  <persistent-overlay>
                    <v-row no-gutters>
                      <div class="mb-1 ml-1 text-caption">
                        {{ volume.widthHeightFrames }}
                        <v-tooltip location="top" activator="parent">
                          Width by height by frames
                        </v-tooltip>
                      </div>
                    </v-row>
                  </persistent-overlay>

                  <persistent-overlay
                    v-if="
                      volume.progress &&
                      volume.progress.state &&
                      volume.progress.state !== 'Remote'
                    "
                  >
                    <div class="d-flex flex-column fill-height ma-0">
                      <v-row no-gutters justify="center" align="end">
                        <v-progress-circular
                          color="white"
                          :indeterminate="
                            volume.progress.percent === 0 &&
                            volume.progress.state !== 'Done'
                          "
                          :model-value="volume.progress.percent"
                        >
                          <v-icon
                            v-if="volume.progress.state === 'Done'"
                            color="white"
                          >
                            mdi-check
                          </v-icon>
                          <v-icon
                            v-else-if="volume.progress.state === 'Error'"
                            color="white"
                          >
                            mdi-alert-circle
                          </v-icon>
                          <span
                            v-else-if="volume.progress.percent !== 0"
                            class="text-caption text--white"
                          >
                            {{ volume.progress.percent }}
                          </span>
                        </v-progress-circular>
                      </v-row>
                      <v-row no-gutters justify="center" align="end">
                        <div
                          v-if="volume.progress.loaded !== 0"
                          class="mb-1 text-caption"
                        >
                          {{ formatBytes(volume.progress.loaded) }}
                        </div>
                      </v-row>
                    </div>
                  </persistent-overlay>
                </v-img>
              </div>
            </v-row>
            <v-card-text
              class="text--primary text-caption text-center series-desc mt-n3"
            >
              <div class="text-ellipsis">
                {{ volume.info.SeriesDescription || '(no series description)' }}
              </div>
            </v-card-text>
          </v-card>
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

.thumbnail-container {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}

.fetching {
  align-self: center;
  justify-self: center;
}
</style>
