<script lang="ts">
import { computed, defineComponent, reactive, watch } from 'vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import ImageListCard from '@/src/components/ImageListCard.vue';
import { createVTKImageThumbnailer } from '@/src/core/thumbnailers/vtk-image';
import { useImageStore } from '../store/datasets-images';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
  ImageSelection,
  selectionEquals,
  useDatasetStore,
} from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';
import { useLayersStore } from '../store/datasets-layers';

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
    const dicomStore = useDICOMStore();
    const dataStore = useDatasetStore();
    const layersStore = useLayersStore();

    const primarySelection = computed(() => dataStore.primarySelection);

    const nonDICOMImages = computed(() =>
      imageStore.idList.filter((id) => !(id in dicomStore.imageIDToVolumeKey))
    );

    const images = computed(() => {
      const { metadata } = imageStore;

      const layerImages = layersStore
        .getLayers(primarySelection.value)
        .filter(({ selection }) => selection.type === 'image');
      const layerImageIDs = layerImages.map(
        ({ selection }) => (selection as ImageSelection).dataID
      );
      const loadedLayerImageIDs = layerImages
        .filter(({ id }) => id in layersStore.layerImages)
        .map(({ selection }) => (selection as ImageSelection).dataID);

      const selectedImageID =
        primarySelection.value?.type === 'image' &&
        primarySelection.value?.dataID;

      return nonDICOMImages.value.map((id) => {
        const selectionKey = {
          type: 'image',
          dataID: id,
        } as DataSelection;
        const layerAdded = layerImageIDs.includes(id);
        const layerLoaded = loadedLayerImageIDs.includes(id);
        const loading = layerAdded && !layerLoaded;
        const layerable = id !== selectedImageID && primarySelection.value;
        return {
          id,
          cacheKey: imageCacheKey(id),
          // for UI selection
          selectionKey,
          name: metadata[id].name,
          dimensions: metadata[id].dimensions,
          spacing: [...metadata[id].spacing].map((s) => s.toFixed(2)),
          layerable,
          loading,
          layerIcon: layerAdded ? 'mdi-layers-minus' : 'mdi-layers-plus',
          layerTooltip: layerAdded ? 'Remove Layer' : 'Add Layer',
          layerHandler: () => {
            if (!loading && layerable) {
              if (layerAdded)
                layersStore.deleteLayer(primarySelection.value, selectionKey);
              else layersStore.addLayer(primarySelection.value, selectionKey);
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
            const imageData = imageStore.dataIndex[id];
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

    // --- selection --- //

    const { selected, selectedAll, selectedSome } =
      useMultiSelection(nonDICOMImages);

    function removeSelection() {
      selected.value.forEach((id) => {
        imageStore.deleteData(id);
      });
      selected.value = [];
    }

    return {
      selected,
      selectedAll,
      selectedSome,
      removeSelection,
      images,
      thumbnails,
      primarySelection,
      selectionEquals,
      setPrimarySelection: (sel: DataSelection) => {
        dataStore.setPrimarySelection(sel);
      },
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
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="6" align-self="center" class="d-flex justify-end">
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
      :model-value="primarySelection"
      :equals-test="selectionEquals"
      @update:model-value="setPrimarySelection"
    >
      <groupable-item
        v-for="image in images"
        :key="image.id"
        v-slot="{ active, select }"
        :value="image.selectionKey"
      >
        <image-list-card
          v-model="selected"
          class="mt-1"
          selectable
          :inputValue="image.id"
          :active="active"
          :html-title="image.name"
          :image-url="(thumbnails[image.cacheKey] || {}).imageURI || ''"
          :image-size="100"
          :id="image.id"
          @click="select"
        >
          <div class="text-body-2 font-weight-bold text-no-wrap text-truncate">
            {{ image.name }}
          </div>
          <div class="text-caption">
            Dims: ({{ image.dimensions.join(', ') }})
          </div>
          <div class="text-caption">
            Spacing: ({{ image.spacing.join(', ') }})
          </div>
          <v-btn
            icon
            variant="text"
            :disabled="!image.layerable"
            :loading="image.loading"
            @click.stop="image.layerHandler()"
            class="mt-1"
          >
            <v-icon :icon="image.layerIcon" />
            <v-tooltip location="top" activator="parent">
              {{ image.layerTooltip }}
            </v-tooltip>
          </v-btn>
        </image-list-card>
      </groupable-item>
    </item-group>
  </div>
</template>
