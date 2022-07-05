<script lang="ts">
import { computed, defineComponent, ref, toRefs } from '@vue/composition-api';
import type { PropType } from '@vue/composition-api';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
  selectionEquals,
  useDatasetStore,
} from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';

function dicomCacheKey(volKey: string) {
  return `dicom-${volKey}`;
}

export default defineComponent({
  name: 'PatientBrowser',
  props: {
    volumeKeys: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
  },
  components: {
    GroupableItem,
  },
  setup(props) {
    const { volumeKeys } = toRefs(props);
    const dicomStore = useDICOMStore();
    const dataStore = useDatasetStore();

    const volumes = computed(() => {
      const { volumeInfo } = dicomStore;
      return volumeKeys.value.map((volumeKey) => ({
        key: volumeKey,
        // for thumbnailing
        cacheKey: dicomCacheKey(volumeKey),
        info: volumeInfo[volumeKey],
        // for UI selection
        selectionKey: {
          type: 'dicom',
          volumeKey,
        } as DataSelection,
      }));
    });

    // --- thumbnails --- //

    const thumbnailCacheRef = ref<Record<string, string>>({});

    /*
    watch(
      studiesAndVolumesRef,
      () => {
        const thumbnailCache = thumbnailCacheRef.value;
        const studiesAndVolumes = studiesAndVolumesRef.value;

        studiesAndVolumes.forEach(({ volumes }) => {
          volumes.forEach(async (volumeInfo) => {
            const cacheKey = dicomCacheKey(volumeInfo.info.VolumeID);
            if (!(cacheKey in thumbnailCache)) {
              const thumb = await generateDICOMThumbnail(
                dicomStore,
                volumeInfo.info.VolumeID
              );

              if (thumb !== null) {
                const encodedImage = itkImageToURI(thumb);
                const aspectRatio = thumb.size[0] / thumb.size[1];

                set(thumbnailCache, cacheKey, { encodedImage, aspectRatio });
              }
            }
          });
        });

        // TODO deletion
      },
      { immediate: true, deep: true }
    );
    */

    // --- selection --- //

    const { selected, selectedAll, selectedSome } =
      useMultiSelection(volumeKeys);

    const removeSelectedDICOMVolumes = () => {
      selected.value.forEach(async (volumeKey) => {
        dicomStore.deleteVolume(volumeKey);
      });

      // Handle the case where we are deleting the selected volume
      // if (primarySelection.value?.type === 'dicom') {
      //   const { volumeKey } = primarySelection.value;

      //   // If we are deleting the selected volume, just reset the primary selection
      //   if (
      //     selectedSeries.value
      //       .map((series: DICOMSelection) => series.volumeKey)
      //       .indexOf(volumeKey) !== -1
      //   ) {
      //     const volumes = dicomStore.studyVolumes[selectedStudy.value];
      //     if (volumes.length > 0) {
      //       dataStore.setPrimarySelection({
      //         type: 'dicom',
      //         volumeKey: volumes[0],
      //       });
      //     } else {
      //       dataStore.setPrimarySelection(null);
      //     }
      //   }
      // }

      selected.value = [];
    };

    return {
      selected,
      selectedAll,
      selectedSome,
      thumbnailCache: thumbnailCacheRef,
      volumes,
      removeSelectedDICOMVolumes,
      selectionEquals,
      setPrimarySelection: (sel: DataSelection) => {
        dataStore.setPrimarySelection(sel);
      },
    };
  },
});
</script>

<template>
  <v-container class="pa-0">
    <v-row no-gutters justify="space-between">
      <v-col cols="6" align-self="center">
        <v-checkbox
          class="ml-3 align-center justify-center"
          :indeterminate="selectedSome && !selectedAll"
          label="Select All"
          v-model="selectedAll"
        ></v-checkbox>
      </v-col>
      <v-col cols="6" align-self="center" class="d-flex justify-end">
        <v-tooltip left>
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              icon
              :disabled="!selectedSome"
              @click.stop="removeSelectedDICOMVolumes"
              v-bind="attrs"
              v-on="on"
            >
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </template>
          Delete selected
        </v-tooltip>
      </v-col>
    </v-row>
    <v-row no-gutters>
      <v-col>
        <div class="my-2 volume-list">
          <groupable-item
            v-for="volume in volumes"
            :key="volume.info.VolumeID"
            v-slot:default="{ active, select }"
            :value="volume.selectionKey"
          >
            <v-card
              outlined
              ripple
              :class="{
                'volume-card': true,
                'volume-card-active': active,
              }"
              :title="volume.info.SeriesDescription"
              @click="select"
            >
              <v-row no-gutters class="pa-0" justify="center">
                <div>
                  <v-img contain height="100px" width="100px" :src="''">
                    <v-overlay
                      absolute
                      class="thumbnail-overlay"
                      value="true"
                      opacity="0"
                    >
                      <div class="d-flex flex-column fill-height">
                        <v-row no-gutters justify="end" align-content="start">
                          <v-checkbox
                            :key="volume.info.VolumeID"
                            :value="volume.key"
                            v-model="selected"
                            @click.stop
                            dense
                          />
                        </v-row>
                        <div class="flex-grow-1" />
                        <v-row no-gutters justify="start" align="end">
                          <div class="mb-2 ml-2">
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
          </groupable-item>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.volume-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  grid-auto-rows: 200px;
  justify-content: center;
}

.volume-card {
  padding: 8px;
  cursor: pointer;
}

.theme--light.volume-card-active {
  background-color: #b3e5fc;
  border-color: #b3e5fc;
}

.theme--dark.volume-card-active {
  background-color: #01579b;
  border-color: #01579b;
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
