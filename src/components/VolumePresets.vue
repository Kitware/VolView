<script lang="ts">
import { computed, defineComponent, watch } from '@vue/composition-api';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useViewConfigStore } from '../store/view-configs';
import { getColorFunctionRangeFromPreset } from '../utils/vtk-helpers';
import { useVolumeThumbnailing } from '../composables/useVolumeThumbnailing';

const THUMBNAIL_SIZE = 80;
const TARGET_VIEW_ID = '3D';

export default defineComponent({
  name: 'VolumePresets',
  components: {
    ItemGroup,
    GroupableItem,
  },
  setup() {
    const viewConfigStore = useViewConfigStore();

    const { currentImageID, currentImageData } = useCurrentImage();

    const volumeColorConfig = viewConfigStore.getComputedVolumeColorConfig(
      TARGET_VIEW_ID,
      currentImageID
    );

    watch(volumeColorConfig, () => {
      const imageID = currentImageID.value;
      if (imageID && !volumeColorConfig.value) {
        // creates a default color config
        viewConfigStore.updateVolumeColorConfig(TARGET_VIEW_ID, imageID, {});
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
      viewConfigStore.setVolumeColorPreset(
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
        viewConfigStore.updateVolumeColorTransferFunction(
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
    <item-group class="container" :value="preset" @change="selectPreset">
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
              blue: active,
            }"
            @click="select"
          >
            <v-img :src="thumbnails[preset] || ''" contain aspect-ratio="1">
              <v-overlay
                absolute
                :value="true"
                opacity="0.3"
                class="thumbnail-overlay"
              >
                {{ preset.replace(/-/g, ' ') }}
              </v-overlay>
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
</style>
