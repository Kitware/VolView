<script lang="ts">
import {
  computed,
  defineComponent,
  del,
  reactive,
  set,
  toRefs,
  watch,
} from '@vue/composition-api';
import Image from 'itk-wasm/dist/core/Image';
import type { PropType } from '@vue/composition-api';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import { DataSelection, useDatasetStore } from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';
import { useMessageStore } from '../store/messages';
import { useLayersStore } from '../store/datasets-layers';

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
    const datasetStore = useDatasetStore();
    const layersStore = useLayersStore();

    const volumes = computed(() => {
      const { volumeInfo } = dicomStore;
      const { primarySelection } = datasetStore;
      const layerVolumeKeys = layersStore
        .getLayers(primarySelection)
        .map(
          ({ selection }) => selection.type === 'dicom' && selection.volumeKey
        )
        .filter(Boolean);
      const selectedVolumeKey =
        primarySelection?.type === 'dicom' && primarySelection.volumeKey;
      return volumeKeys.value.map((volumeKey) => {
        const selectionKey = {
          type: 'dicom',
          volumeKey,
        } as DataSelection;
        const layerAdded = layerVolumeKeys.includes(volumeKey);
        return {
          key: volumeKey,
          // for thumbnailing
          cacheKey: dicomCacheKey(volumeKey),
          info: volumeInfo[volumeKey],
          // for UI selection
          selectionKey,
          layerable: volumeKey !== selectedVolumeKey && primarySelection,
          layerIcon: layerAdded ? 'mdi-layers-minus' : 'mdi-layers-plus',
          layerTooltip: layerAdded ? 'Remove Layer' : 'Add Layer',
          layerHandler: layerAdded
            ? () => layersStore.deleteLayer(primarySelection, selectionKey)
            : () => layersStore.addLayer(primarySelection, selectionKey),
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
              set(thumbnailCache, cacheKey, encodedImage);
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
            del(thumbnailCache, key);
          }
        });
      },
      { immediate: true, deep: true }
    );

    // --- selection --- //

    const { selected, selectedAll, selectedSome } =
      useMultiSelection(volumeKeys);

    const removeSelectedDICOMVolumes = () => {
      selected.value.forEach(async (volumeKey) => {
        dicomStore.deleteVolume(volumeKey);
      });

      selected.value = [];
    };

    return {
      selected,
      selectedAll,
      selectedSome,
      thumbnailCache,
      volumes,
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
          dense
          hide-details
        />
      </v-col>
      <v-col cols="6" align-self="center" class="d-flex justify-end mt-2">
        <v-tooltip left>
          <template v-slot:activator="{ on, attrs }">
            <v-btn
              icon
              small
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
              min-height="180px"
              min-width="180px"
              :title="volume.info.SeriesDescription"
              @click="select"
            >
              <v-row no-gutters class="pa-0" justify="center">
                <div>
                  <v-img
                    contain
                    max-height="150px"
                    max-width="150px"
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
                          color="grey lighten-5"
                        ></v-progress-circular>
                      </v-row>
                    </template>
                    <v-overlay
                      absolute
                      class="thumbnail-overlay"
                      :value="true"
                      opacity="0"
                    >
                      <div class="d-flex flex-column fill-height">
                        <v-row no-gutters justify="end" align-content="start">
                          <v-tooltip top>
                            <template v-slot:activator="{ on, attrs }">
                              <v-btn
                                icon
                                :disabled="!volume.layerable"
                                @click.stop="volume.layerHandler()"
                                v-bind="attrs"
                                v-on="on"
                                class="mt-1"
                              >
                                <v-icon>{{ volume.layerIcon }}</v-icon>
                              </v-btn>
                            </template>
                            {{ volume.layerTooltip }}
                          </v-tooltip>
                          <v-checkbox
                            :key="volume.info.VolumeID"
                            :value="volume.key"
                            v-model="selected"
                            @click.stop
                            dense
                          />
                        </v-row>
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
