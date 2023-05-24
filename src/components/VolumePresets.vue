<script lang="ts">
import { computed, defineComponent, watch } from 'vue';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import PersistentOverlay from './PersistentOverlay.vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import useVolumeColoringStore from '../store/view-configs/volume-coloring';
import { getColorFunctionRangeFromPreset } from '../utils/vtk-helpers';
import { useVolumeThumbnailing } from '../composables/useVolumeThumbnailing';
import { InitViewIDs } from '../config';

const THUMBNAIL_SIZE = 80;
const TARGET_VIEW_ID = InitViewIDs.Three;

export default defineComponent({
  name: 'VolumePresets',
  components: {
    ItemGroup,
    GroupableItem,
    PersistentOverlay,
  },
  setup() {
    const volumeColoringStore = useVolumeColoringStore();

    const { currentImageID, currentImageData } = useCurrentImage();

    const volumeColorConfig = computed(() =>
      volumeColoringStore.getConfig(TARGET_VIEW_ID, currentImageID.value)
    );

    watch(volumeColorConfig, () => {
      const imageID = currentImageID.value;
      if (imageID && !volumeColorConfig.value) {
        // creates a default color config
        volumeColoringStore.updateConfig(TARGET_VIEW_ID, imageID, {});
      }
    });

    const colorTransferFunctionRef = computed(
      () => volumeColorConfig.value?.transferFunction
    );

    const { currentThumbnails } = useVolumeThumbnailing(THUMBNAIL_SIZE);

    // --- selection and updates --- //

    const selectedPreset = computed(
      () => colorTransferFunctionRef.value?.preset || null
    );
    const hasCurrentImage = computed(() => !!currentImageData.value);

    // the data range, if any
    const imageDataRange = computed((): [number, number] => {
      const image = currentImageData.value;
      if (image) {
        return image.getPointData().getScalars().getRange();
      }
      return [0, 1];
    });
    const effectiveMappingRange = computed(
      () =>
        getColorFunctionRangeFromPreset(selectedPreset.value || '') ||
        imageDataRange.value
    );

    const selectPreset = (name: string) => {
      if (!currentImageID.value) return;
      volumeColoringStore.setColorPreset(
        TARGET_VIEW_ID,
        currentImageID.value,
        name
      );
    };

    const rgbPoints = computed(
      () =>
        vtkColorMaps.getPresetByName(colorTransferFunctionRef.value!.preset)
          ?.RGBPoints
    );

    const updateColorMappingRange = (range: [number, number]) => {
      const { mappingRange } = colorTransferFunctionRef.value ?? {};
      // guard against infinite loops
      if (
        currentImageID.value &&
        mappingRange &&
        (Math.abs(range[0] - mappingRange[0]) > 1e-6 ||
          Math.abs(range[1] - mappingRange[1]) > 1e-6)
      ) {
        volumeColoringStore.updateColorTransferFunction(
          TARGET_VIEW_ID,
          currentImageID.value,
          {
            mappingRange: range,
          }
        );
      }
    };

    return {
      thumbnails: currentThumbnails,
      hasCurrentImage,
      preset: selectedPreset,
      fullMappingRange: effectiveMappingRange,
      mappingRange: computed(
        () => colorTransferFunctionRef.value!.mappingRange
      ),
      presetList: PresetNameList,
      size: THUMBNAIL_SIZE,
      rgbPoints,
      selectPreset,
      updateColorMappingRange,
    };
  },
});
</script>

<template>
  <div class="overflow-x-visible mx-2">
    <item-group :model-value="preset" @update:model-value="selectPreset">
      <v-row no-gutters justify="center">
        <groupable-item
          v-for="preset in presetList"
          :key="preset"
          v-slot="{ active, select }"
          :value="preset"
        >
          <v-col
            cols="4"
            :class="{
              'thumbnail-container': true,
              'bg-blue': active,
            }"
            @click="select"
          >
            <v-img :src="thumbnails[preset] || ''" cover aspect-ratio="1">
              <persistent-overlay class="thumbnail-overlay">
                <div class="thumbnail-overlay-text">
                  {{ preset.replace(/-/g, ' ') }}
                </div>
              </persistent-overlay>
            </v-img>
          </v-col>
        </groupable-item>
      </v-row>
    </item-group>
  </div>
</template>

<style scoped>
.thumbnail-container {
  cursor: pointer;
  padding: 6px !important;
}

.thumbnail-overlay {
  top: 70%;
  height: 30%;
  font-size: 0.75em;
  text-align: center;
}

.thumbnail-overlay-text {
  display: flex;
  flex-flow: row;
  align-items: center;
  justify-content: space-around;
  width: 100%;
  height: 100%;
  padding: 2px 4px;
  color: white;
}
</style>
