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
import { useDicomMetaStore } from './dicom-meta-store';
import {
  useDicomWebStore,
  isDownloadable,
  VolumeProgress,
} from './dicom-web-store';
import { formatBytes } from '../utils';

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
  components: {},
  setup(props) {
    const { volumeKeys } = toRefs(props);

    const dicomStore = useDicomMetaStore();
    const dicomWebStore = useDicomWebStore();

    const volumes = computed(() => {
      const { volumeInfo, volumeInstances, instanceInfo } = dicomStore;
      return volumeKeys.value.map((volumeKey) => {
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
      volumeKeys,
      (keys) => {
        keys
          .filter((key) => !(key in thumbnailCache))
          .forEach(async (key) => {
            const thumb = await dicomWebStore.fetchVolumeThumbnail(key);
            if (thumb !== null) {
              set(thumbnailCache, key, thumb);
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
              :class="{
                'volume-card': true,
              }"
              min-height="180px"
              min-width="180px"
              :title="volume.info.SeriesDescription"
              :disabled="volume.isDisabled"
              :ripple="!volume.isDisabled"
              @click="downloadDicom(volume.info.VolumeID)"
            >
              <v-row no-gutters class="pa-0" justify="center">
                <div>
                  <v-img
                    contain
                    max-height="150px"
                    max-width="150px"
                    :src="(thumbnailCache || {})[volume.key] || ''"
                  >
                    <v-overlay
                      absolute
                      class="thumbnail-overlay"
                      :value="true"
                      opacity="0"
                    >
                      <v-tooltip top>
                        <template v-slot:activator="{ on }">
                          <v-row no-gutters>
                            <div class="mb-1 ml-1 text-caption" v-on="on">
                              {{ volume.widthHeightFrames }}
                            </div>
                          </v-row>
                        </template>
                        Width by height by frames
                      </v-tooltip>
                    </v-overlay>

                    <v-overlay
                      v-if="
                        volume.progress &&
                        volume.progress.state &&
                        volume.progress.state !== 'Remote'
                      "
                      absolute
                      class="thumbnail-overlay"
                      :value="true"
                      opacity="0"
                    >
                      <div class="d-flex flex-column fill-height ma-0">
                        <v-row no-gutters justify="center" align="end">
                          <v-progress-circular
                            color="white"
                            :indeterminate="
                              volume.progress.percent === 0 &&
                              volume.progress.state !== 'Done'
                            "
                            :value="volume.progress.percent"
                          >
                            <v-icon
                              v-if="volume.progress.state === 'Done'"
                              small
                              color="white"
                              >mdi-check</v-icon
                            >
                            <v-icon
                              v-else-if="volume.progress.state === 'Error'"
                              small
                              color="white"
                            >
                              mdi-alert-circle
                            </v-icon>
                            <span
                              v-else-if="volume.progress.percent !== 0"
                              class="caption text--white"
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
                    </v-overlay>
                  </v-img>
                </div>
              </v-row>
              <v-card-text
                class="text--primary text-caption text-center series-desc mt-n3"
              >
                <div class="text-ellipsis">
                  {{
                    volume.info.SeriesDescription || '(no series description)'
                  }}
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
