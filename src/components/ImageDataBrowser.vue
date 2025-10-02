<script lang="ts">
import { computed, defineComponent, reactive, watch } from 'vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import ImageListCard from '@/src/components/ImageListCard.vue';
import { createVTKImageThumbnailer } from '@/src/core/thumbnailers/vtk-image';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import {
  isRegularImage,
  type DataSelection,
  selectionEquals,
} from '@/src/utils/dataSelection';
import { useImageCacheStore } from '@/src/store/image-cache';
import { defaultImageMetadata } from '@/src/core/progressiveImage';
import { useImageStore } from '@/src/store/datasets-images';
import { useDatasetStore } from '@/src/store/datasets';

import { useMultiSelection } from '@/src/composables/useMultiSelection';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { useViewCameraStore } from '@/src/store/view-configs/camera';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';
import { IMAGE_DRAG_MEDIA_TYPE } from '@/src/constants';

function imageCacheKey(dataID: string) {
  return `image-${dataID}`;
}

export default defineComponent({
  components: {
    ItemGroup,
    GroupableItem,
    ImageListCard,
  },
  setup() {
    const imageStore = useImageStore();
    const dataStore = useDatasetStore();
    const layersStore = useLayersStore();
    const segmentGroupStore = useSegmentGroupStore();
    const viewSliceStore = useViewSliceStore();
    const viewCameraStore = useViewCameraStore();
    const imageCacheStore = useImageCacheStore();
    const viewStore = useViewStore();

    const { currentImageID } = useCurrentImage();

    const nonDICOMImages = computed(() => imageStore.idList);

    const images = computed(() => {
      const layerImages = layersStore
        .getLayers(currentImageID.value)
        .filter(({ selection }) => isRegularImage(selection));
      const layerImageIDs = layerImages.map(({ selection }) => selection);
      const loadedLayerImageIDs = layerImages
        .filter(({ id }) => imageCacheStore.imageById[id]?.isLoaded())
        .map(({ selection }) => selection);

      const selectedImageID =
        isRegularImage(currentImageID.value) && currentImageID.value;

      return nonDICOMImages.value.map((id) => {
        const selectionKey = id as DataSelection;
        const isLayer = layerImageIDs.includes(id);
        const layerLoaded = loadedLayerImageIDs.includes(id);
        const layerLoading = isLayer && !layerLoaded;
        const layerable =
          id !== selectedImageID && currentImageID.value != null;
        const metadata =
          imageCacheStore.getImageMetadata(id) ?? defaultImageMetadata();
        return {
          id,
          cacheKey: imageCacheKey(id),
          // for UI selection
          selectionKey,
          name: metadata.name,
          dimensions: metadata.dimensions,
          spacing: [...metadata.spacing].map((s) => s.toFixed(2)),
          layerable,
          layerLoading,
          isLayer,
          layerHandler: () => {
            if (!layerLoading && layerable) {
              if (isLayer)
                layersStore.deleteLayer(currentImageID.value, selectionKey);
              else layersStore.addLayer(currentImageID.value, selectionKey);
            }
          },
        };
      });
    });

    // --- thumbnails --- //

    type Thumbnail = {
      imageURI: string;
      aspectRatio: number;
    };
    const thumbnails = reactive<Record<string, Thumbnail>>({});
    const thumbnailer = createVTKImageThumbnailer();

    watch(
      nonDICOMImages,
      (imageIDs) => {
        imageIDs.forEach(async (id) => {
          const cacheKey = imageCacheKey(id);
          if (!(cacheKey in thumbnails)) {
            const imageData = imageCacheStore.getVtkImageData(id);
            if (!imageData) return;
            const canvasIM = thumbnailer.generate(imageData);
            const imageURI = thumbnailer.imageDataToDataURI(canvasIM, 100, 100);
            const dims = imageData.getDimensions();
            const aspectRatio = dims[0] / dims[1];
            thumbnails[cacheKey] = { imageURI, aspectRatio };
          }
        });

        // delete old thumbnails
        const idLookup = new Set(imageIDs.map((id) => imageCacheKey(id)));
        Object.keys(thumbnails).forEach((cacheKey) => {
          if (!idLookup.has(cacheKey)) {
            delete thumbnails[cacheKey];
          }
        });
      },
      { immediate: true, deep: true }
    );

    // --- sync --- //
    const sameSpaceImages = computed(() => {
      return imageStore.checkAllImagesSameSpace();
    });
    const isSync = computed(() => {
      return viewSliceStore.isSync() && viewCameraStore.isSync();
    });
    function toggleSyncImages() {
      viewSliceStore.toggleSyncImages();
      viewCameraStore.toggleSyncCameras();
      viewCameraStore.disableCameraAutoReset = isSync.value;
    }
    watch(isSync, () => {
      viewSliceStore.updateSyncConfigs();
      viewCameraStore.updateSyncConfigs();
    });

    // --- selection --- //

    const { selected, selectedAll, selectedSome, toggleSelectAll } =
      useMultiSelection(nonDICOMImages);

    function removeSelection() {
      selected.value.forEach(dataStore.remove);
      selected.value = [];
    }

    function convertToLabelMap(key: string) {
      if (currentImageID.value) {
        segmentGroupStore.convertImageToLabelmap(key, currentImageID.value);
      }
    }

    function removeData(id: string) {
      dataStore.remove(id);
    }

    function setViewImage(imageID: string) {
      viewStore.setDataForActiveView(imageID);
    }

    function showInAllViews(imageID: string) {
      viewStore.setDataForAllViews(imageID);
    }

    function onDragStart(imageID: string, event: DragEvent) {
      event.dataTransfer?.setData(IMAGE_DRAG_MEDIA_TYPE, imageID);
    }

    return {
      selected,
      selectedAll,
      selectedSome,
      toggleSelectAll,
      removeSelection,
      removeData,
      convertToLabelMap,
      images,
      thumbnails,
      currentImageID,
      selectionEquals,
      sameSpaceImages,
      toggleSyncImages,
      isSync,
      setViewImage,
      showInAllViews,
      onDragStart,
    };
  },
});
</script>

<template>
  <div>
    <div v-if="images.length === 0" class="text-center">No images loaded</div>
    <v-container v-show="images.length" class="pa-0">
      <v-row no-gutters justify="space-between" align="center" class="mb-1">
        <v-col cols="6">
          <v-checkbox
            class="ml-3"
            :indeterminate="selectedSome && !selectedAll"
            label="Select All"
            v-model="selectedAll"
            @click.stop="toggleSelectAll"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="6" align-self="center" class="d-flex justify-end">
          <v-btn
            icon
            variant="text"
            :disabled="!sameSpaceImages"
            @click.stop="toggleSyncImages"
          >
            <v-icon v-if="isSync">mdi-lock</v-icon>
            <v-icon flip="vertical" v-else>mdi-lock-open-variant</v-icon>
            <v-tooltip
              :disabled="!sameSpaceImages"
              location="left"
              activator="parent"
            >
              Sync Images
            </v-tooltip>
          </v-btn>
          <v-btn
            icon
            variant="text"
            :disabled="!selectedSome"
            @click.stop="removeSelection"
          >
            <v-icon>mdi-delete</v-icon>
            <v-tooltip
              :disabled="!selectedSome"
              location="left"
              activator="parent"
            >
              Delete selected
            </v-tooltip>
          </v-btn>
        </v-col>
      </v-row>
    </v-container>
    <item-group
      :model-value="currentImageID"
      :equals-test="selectionEquals"
      @update:model-value="setViewImage"
    >
      <groupable-item
        v-for="image in images"
        :key="image.id"
        v-slot="{ active, select }"
        :value="image.selectionKey"
      >
        <image-list-card
          v-model="selected"
          class="mt-1 position-relative"
          selectable
          :inputValue="image.id"
          :active="active"
          :html-title="image.name"
          :image-url="(thumbnails[image.cacheKey] || {}).imageURI || ''"
          :image-size="100"
          :id="image.id"
          draggable="true"
          @click="select"
          @dragstart="onDragStart(image.id, $event)"
        >
          <div class="d-flex flex-row justify-space-between">
            <div class="allow-trunc-text-flex-child">
              <div
                class="text-body-2 font-weight-bold text-no-wrap text-truncate"
              >
                {{ image.name }}
              </div>
              <div class="text-caption">
                Dims: ({{ image.dimensions.join(', ') }})
              </div>
              <div class="text-caption">
                Spacing: ({{ image.spacing.join(', ') }})
              </div>
            </div>
            <v-btn icon variant="plain" size="x-small" class="dataset-menu">
              <v-menu activator="parent">
                <v-list>
                  <v-list-item
                    v-if="image.layerable"
                    @click.stop="image.layerHandler()"
                  >
                    <template v-if="image.layerLoading">
                      <div style="margin: 0 auto">
                        <v-progress-circular indeterminate size="small" />
                      </div>
                    </template>
                    <template v-else>
                      <span v-if="image.isLayer">Remove as layer</span>
                      <span v-else>Add as layer</span>
                    </template>
                  </v-list-item>
                  <v-list-item
                    @click="
                      image.layerable ? convertToLabelMap(image.id) : null
                    "
                  >
                    <v-icon v-if="!image.layerable" class="mr-1">
                      mdi-alert
                    </v-icon>
                    Add as Segment Group
                    <v-tooltip
                      activator="parent"
                      location="end"
                      max-width="200px"
                      :disabled="image.layerable"
                    >
                      Must load a background image before converting
                    </v-tooltip>
                  </v-list-item>
                  <v-list-item @click="showInAllViews(image.id)">
                    Show in all views
                  </v-list-item>
                  <v-list-item @click="removeData(image.id)">
                    Delete
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-icon size="medium">mdi-dots-vertical</v-icon>
            </v-btn>
          </div>
        </image-list-card>
      </groupable-item>
    </item-group>
  </div>
</template>

<style scoped>
.allow-trunc-text-flex-child {
  min-width: 0;
}

.dataset-menu {
  position: relative;
  top: -8px;
  right: -4px;
}
</style>
