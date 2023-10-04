<script lang="ts">
import { computed, defineComponent, reactive, toRefs, watch } from 'vue';
import { Image } from 'itk-wasm';
import type { PropType } from 'vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
  DICOMSelection,
  useDatasetStore,
} from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';
import { useMessageStore } from '../store/messages';
import { useLayersStore } from '../store/datasets-layers';
import PersistentOverlay from './PersistentOverlay.vue';

const canvas = document.createElement('canvas');

function dicomCacheKey(volKey: string) {
  return `dicom-${volKey}`;
}

// Assume itkImage type is Uint8Array
function itkImageToURI(itkImage: Image) {
  const [width, height] = itkImage.size;
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  const itkBuf = itkImage.data;
  if (!itkBuf) {
    return '';
  }

  for (let i = 0; i < itkBuf.length; i += 1) {
    const byte = itkBuf[i] as number;
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return '';
}

async function generateDICOMThumbnail(
  dicomStore: ReturnType<typeof useDICOMStore>,
  volumeKey: string
) {
  if (volumeKey in dicomStore.volumeInfo) {
    return (await dicomStore.getVolumeThumbnail(volumeKey)) as Image;
  }
  throw new Error('No matching volume key in dicomStore');
}

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

    const volumes = computed(() => {
      const { volumeInfo } = dicomStore;
      const { primarySelection } = datasetStore;
      const layerVolumes = layersStore
        .getLayers(primarySelection)
        .filter(({ selection }) => selection.type === 'dicom');
      const layerVolumeKeys = layerVolumes.map(
        ({ selection }) => (selection as DICOMSelection).volumeKey
      );
      const loadedLayerVolumeKeys = layerVolumes
        .filter(({ id }) => id in layersStore.layerImages)
        .map(({ selection }) => (selection as DICOMSelection).volumeKey);
      const selectedVolumeKey =
        primarySelection?.type === 'dicom' && primarySelection.volumeKey;

      return volumeKeys.value.map((volumeKey) => {
        const selectionKey = {
          type: 'dicom',
          volumeKey,
        } as DataSelection;
        const isLayer = layerVolumeKeys.includes(volumeKey);
        const layerLoaded = loadedLayerVolumeKeys.includes(volumeKey);
        const layerLoading = isLayer && !layerLoaded;
        const layerable = volumeKey !== selectedVolumeKey && primarySelection;
        return {
          key: volumeKey,
          // for thumbnailing
          cacheKey: dicomCacheKey(volumeKey),
          info: volumeInfo[volumeKey],
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

    const thumbnailCache = reactive<Record<string, string>>({});

    watch(
      volumeKeys,
      (keys) => {
        keys.forEach(async (key) => {
          const cacheKey = dicomCacheKey(key);
          if (cacheKey in thumbnailCache) {
            return;
          }

          try {
            const thumb = await generateDICOMThumbnail(dicomStore, key);
            if (thumb !== null) {
              const encodedImage = itkImageToURI(thumb);
              thumbnailCache[cacheKey] = encodedImage;
            }
          } catch (err) {
            if (err instanceof Error) {
              const messageStore = useMessageStore();
              messageStore.addError('Failed to generate thumbnails', {
                details: `${err}. More details can be found in the developer's console.`,
              });
            }
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
      dicomStore.deleteVolume(key);
    };

    const removeSelectedDICOMVolumes = () => {
      selected.value.forEach((volumeKey) => {
        removeData(volumeKey);
      });

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
                    :src="(thumbnailCache || {})[volume.cacheKey] || ''"
                  >
                    <template v-slot:placeholder>
                      <v-row
                        class="fill-height ma-0"
                        align="center"
                        justify="center"
                      >
                        <v-progress-circular
                          indeterminate
                          color="grey-lighten-5"
                        />
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
                >
                  <v-menu activator="parent">
                    <v-list>
                      <v-list-item
                        v-if="volume.layerable"
                        @click.stop="volume.layerHandler()"
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
