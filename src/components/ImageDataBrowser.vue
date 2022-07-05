<script lang="ts">
import {
  computed,
  defineComponent,
  set,
  del,
  reactive,
  watch,
} from '@vue/composition-api';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import ImageListCard from '@/src/components/ImageListCard.vue';
import { createVTKImageThumbnailer } from '@/src/core/thumbnailers/vtk-image';
import { useImageStore } from '../store/datasets-images';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
  selectionEquals,
  useDatasetStore,
} from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';

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

    const primarySelection = computed(() => dataStore.primarySelection);

    const nonDICOMImages = computed(() =>
      imageStore.idList.filter((id) => !(id in dicomStore.imageIDToVolumeKey))
    );

    const images = computed(() => {
      const { metadata } = imageStore;
      return nonDICOMImages.value.map((id) => ({
        id,
        cacheKey: imageCacheKey(id),
        // for UI selection
        selectionKey: {
          type: 'image',
          dataID: id,
        } as DataSelection,
        name: metadata[id].name,
        dimensions: metadata[id].dimensions,
        spacing: [...metadata[id].spacing].map((s) => s.toFixed(2)),
      }));
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
            set(thumbnails, cacheKey, { imageURI, aspectRatio });
          }
        });

        // delete old thumbnails
        const idLookup = new Set(imageIDs.map((id) => imageCacheKey(id)));
        Object.keys(thumbnails).forEach((cacheKey) => {
          if (!idLookup.has(cacheKey)) {
            del(thumbnails, cacheKey);
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
                @click.stop="removeSelection"
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
    </v-container>
    <item-group
      :value="primarySelection"
      :testFunction="selectionEquals"
      @change="setPrimarySelection"
    >
      <groupable-item
        v-for="image in images"
        :key="image.id"
        v-slot="{ active, select }"
        :value="image.selectionKey"
      >
        <image-list-card
          selectable
          :active="active"
          :title="image.name"
          :image-url="(thumbnails[image.cacheKey] || {}).imageURI || ''"
          :image-size="100"
          @click="select"
          :id="image.id"
          :inputValue="image.id"
          v-model="selected"
        >
          <div class="text-body-2 font-weight-bold text-no-wrap text-truncate">
            {{ image.name }}
          </div>
          <div class="caption">Dims: ({{ image.dimensions.join(', ') }})</div>
          <div class="caption">Spacing: ({{ image.spacing.join(', ') }})</div>
        </image-list-card>
      </groupable-item>
    </item-group>
  </div>
</template>
