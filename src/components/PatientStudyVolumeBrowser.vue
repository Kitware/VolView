<script lang="ts">
import { computed, defineComponent, reactive, toRefs, watch } from 'vue';
import type { PropType } from 'vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { DataSelection, isDicomImage } from '@/src/utils/dataSelection';
import { ThumbnailStrategy } from '@/src/core/streaming/chunkImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { getDisplayName, useDICOMStore } from '../store/datasets-dicom';
import { useDatasetStore } from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';
import { useMessageStore } from '../store/messages';
import { useLayersStore } from '../store/datasets-layers';
import PersistentOverlay from './PersistentOverlay.vue';

function dicomCacheKey(volKey: string) {
  return `dicom-${volKey}`;
}

type Thumbnail =
  | { kind: 'image'; value: string }
  | { kind: 'text'; value: string };

export default defineComponent({
  name: 'PatientStudyVolumeBrowser',
  props: {
    volumeKeys: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
  },
  components: {
    GroupableItem,
    PersistentOverlay,
  },
  setup(props) {
    const { volumeKeys } = toRefs(props);
    const dicomStore = useDICOMStore();
    const datasetStore = useDatasetStore();
    const layersStore = useLayersStore();
    const imageCacheStore = useImageCacheStore();

    const primarySelectionRef = computed(() => datasetStore.primarySelection);
    const volumes = computed(() => {
      const volumeInfo = dicomStore.volumeInfo;
      const primarySelection = primarySelectionRef.value;
      const layerVolumes = layersStore
        .getLayers(primarySelection)
        .filter(({ selection }) => isDicomImage(selection));
      const layerVolumeKeys = layerVolumes.map(({ selection }) => selection);
      const loadedLayerVolumeKeys = layerVolumes
        .filter(({ id }) => imageCacheStore.imageById[id]?.isLoaded())
        .map(({ selection }) => selection);
      const selectedVolumeKey =
        isDicomImage(primarySelection) && primarySelection;

      return volumeKeys.value.map((volumeKey) => {
        const selectionKey = volumeKey as DataSelection;
        const isLayer = layerVolumeKeys.includes(volumeKey);
        const layerLoaded = loadedLayerVolumeKeys.includes(volumeKey);
        const layerLoading = isLayer && !layerLoaded;
        const layerable = volumeKey !== selectedVolumeKey && primarySelection;
        return {
          key: volumeKey,
          // for thumbnailing
          cacheKey: dicomCacheKey(volumeKey),
          info: volumeInfo[volumeKey],
          name: getDisplayName(volumeInfo[volumeKey]),
          // for UI selection
          selectionKey,
          isLayer,
          layerable,
          layerLoading,
          layerHandler: () => {
            if (!layerLoading && layerable) {
              if (isLayer)
                layersStore.deleteLayer(primarySelection, selectionKey);
              else layersStore.addLayer(primarySelection, selectionKey);
            }
          },
        };
      });
    });

    // --- thumbnails --- //

    const thumbnailCache = reactive<Record<string, Thumbnail>>({});

    watch(
      volumeKeys,
      (keys) => {
        keys.forEach(async (key) => {
          const cacheKey = dicomCacheKey(key);
          if (cacheKey in thumbnailCache) {
            return;
          }

          const image = imageCacheStore.imageById[key];
          if (!image || !(image instanceof DicomChunkImage)) return;

          try {
            const thumb = await image.getThumbnail(
              ThumbnailStrategy.MiddleSlice
            );
            if (thumb !== null) {
              thumbnailCache[cacheKey] = { kind: 'image', value: thumb };
            } else {
              thumbnailCache[cacheKey] = {
                kind: 'text',
                value: dicomStore.volumeInfo[key].Modality,
              };
            }
          } catch (err) {
            if (err instanceof Error) {
              const messageStore = useMessageStore();
              messageStore.addError('Failed to generate thumbnails', {
                details: `${err}. More details can be found in the developer's console.`,
              });
            }
            thumbnailCache[cacheKey] = {
              kind: 'text',
              value: dicomStore.volumeInfo[key].Modality,
            };
          }
        });

        // deletion case
        const lookup = new Set(keys.map((key) => dicomCacheKey(key)));
        Object.keys(thumbnailCache).forEach((key) => {
          if (!lookup.has(key)) {
            delete thumbnailCache[key];
          }
        });
      },
      { immediate: true, deep: true }
    );

    // --- selection --- //

    const { selected, selectedAll, selectedSome, toggleSelectAll } =
      useMultiSelection(volumeKeys);

    const removeData = (key: string) => {
      datasetStore.remove(key);
    };

    const removeSelectedDICOMVolumes = () => {
      // make copy of selected as removing selected will change the array
      [...selected.value].forEach(removeData);

      selected.value = [];
    };

    return {
      selected,
      selectedAll,
      selectedSome,
      toggleSelectAll,
      thumbnailCache,
      volumes,
      removeData,
      removeSelectedDICOMVolumes,
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
          @click.stop="toggleSelectAll"
          density="compact"
          hide-details
        />
      </v-col>
      <v-col cols="6" align-self="center" class="d-flex justify-end mt-2">
        <v-btn
          icon
          variant="text"
          :disabled="!selectedSome"
          @click.stop="removeSelectedDICOMVolumes"
        >
          <v-icon>mdi-delete</v-icon>
          <v-tooltip location="left" activator="parent">
            Delete selected
          </v-tooltip>
        </v-btn>
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
              variant="outlined"
              ripple
              :class="{
                'volume-card': true,
                'mt-1': true,
                'volume-card-active': active,
              }"
              min-height="180px"
              min-width="180px"
              :html-title="volume.info.SeriesDescription"
              @click="select"
            >
              <v-row no-gutters class="pa-0" justify="center">
                <div class="thumbnail-container">
                  <v-img
                    cover
                    height="150"
                    width="150"
                    :src="
                      (thumbnailCache[volume.cacheKey] &&
                        thumbnailCache[volume.cacheKey].kind === 'image' &&
                        thumbnailCache[volume.cacheKey].value) ||
                      ''
                    "
                  >
                    <template v-slot:placeholder>
                      <v-row
                        class="fill-height ma-0"
                        align="center"
                        justify="center"
                      >
                        <v-progress-circular
                          v-if="thumbnailCache[volume.cacheKey] === undefined"
                          indeterminate
                          color="grey-lighten-5"
                        />
                        <span
                          v-else-if="
                            thumbnailCache[volume.cacheKey] &&
                            thumbnailCache[volume.cacheKey].kind === 'text'
                          "
                        >
                          {{ thumbnailCache[volume.cacheKey].value }}
                        </span>
                      </v-row>
                    </template>
                    <persistent-overlay>
                      <div class="d-flex flex-column fill-height">
                        <v-row no-gutters justify="end" align-content="start">
                          <v-checkbox
                            :key="volume.info.VolumeID"
                            :value="volume.key"
                            v-model="selected"
                            @click.stop
                            density="compact"
                            hide-details
                            class="series-selector"
                          />
                        </v-row>
                        <v-spacer />
                        <v-row no-gutters justify="start" align="end">
                          <div class="mb-1 ml-1 text-caption">
                            [{{ volume.info.NumberOfSlices }}]
                          </div>
                        </v-row>
                      </div>
                    </persistent-overlay>
                  </v-img>
                </div>
                <v-btn
                  icon
                  variant="plain"
                  size="x-small"
                  class="dataset-menu"
                  @click.stop
                  data-testid="dataset-menu-button"
                >
                  <v-menu activator="parent">
                    <v-list>
                      <v-list-item
                        v-if="volume.layerable"
                        @click.stop="volume.layerHandler()"
                        data-testid="dataset-menu-layer-item"
                      >
                        <template v-if="volume.layerLoading">
                          <div style="margin: 0 auto">
                            <v-progress-circular indeterminate size="small" />
                          </div>
                        </template>
                        <template v-else>
                          <span v-if="volume.isLayer">Remove as layer</span>
                          <span v-else>Add as layer</span>
                        </template>
                      </v-list-item>
                      <v-list-item @click="removeData(volume.key)">
                        Delete
                      </v-list-item>
                    </v-list>
                  </v-menu>
                  <v-icon size="medium">mdi-dots-vertical</v-icon>
                </v-btn>
              </v-row>
              <v-card-text
                class="text--primary text-caption text-center series-desc mt-n3"
              >
                <div class="text-ellipsis">
                  {{ volume.name }}
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  grid-auto-rows: 200px;
  justify-content: center;
}

.volume-card {
  padding: 8px;
  cursor: pointer;
}

.volume-card-active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.series-desc {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.series-selector {
  max-width: 36px;
}

.thumbnail-container {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}

.dataset-menu {
  position: absolute;
  top: 4px;
  right: 4px;
}
</style>
