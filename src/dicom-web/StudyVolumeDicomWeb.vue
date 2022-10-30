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
import { useDicomMetaStore } from './dicom-meta.store';
import { useDicomWebStore, isDownloadable } from './dicom-web.store';

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
        info: volumeInfo[volumeKey],
        isDisabled: !isDownloadable(dicomWebStore.volumes[volumeKey]),
      }));
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
