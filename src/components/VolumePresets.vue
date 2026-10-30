<script lang="ts">
import { computed, defineComponent } from 'vue';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import PersistentOverlay from '@/src/components/PersistentOverlay.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { useVolumeThumbnailing } from '@/src/composables/useVolumeThumbnailing';
import {
  getAdaptiveVolumePresetDescription,
  getAdaptiveVolumePresetUnavailableReason,
  isAdaptiveVolumePreset,
} from '@/src/utils/adaptiveVolumePreset';

const THUMBNAIL_SIZE = 80;

export default defineComponent({
  name: 'VolumePresets',
  components: {
    ItemGroup,
    GroupableItem,
    PersistentOverlay,
  },
  props: {
    viewId: {
      type: String,
      default: null,
    },
  },
  setup(props) {
    const volumeColoringStore = useVolumeColoringStore();
    const viewId = computed(() => props.viewId);

    const { currentImageID, currentImageData, currentImage } =
      useCurrentImage();

    useVolumeColoringInitializer(viewId, currentImageID);

    const volumeColorConfig = computed(() =>
      volumeColoringStore.getConfig(viewId.value, currentImageID.value)
    );

    const colorTransferFunctionRef = computed(
      () => volumeColorConfig.value?.transferFunction
    );

    const { currentThumbnails } = useVolumeThumbnailing(THUMBNAIL_SIZE);

    // --- selection and updates --- //

    const selectedPreset = computed(
      () => colorTransferFunctionRef.value?.preset || null
    );
    const adaptiveUnavailableReason = computed(() =>
      getAdaptiveVolumePresetUnavailableReason(
        currentImageData.value,
        !!currentImage.value?.isLoaded()
      )
    );
    const presetUnavailableReason = (name: string) =>
      isAdaptiveVolumePreset(name) ? adaptiveUnavailableReason.value : '';
    const hasCurrentImage = computed(() => !!currentImageData.value);

    const selectPreset = (name: string) => {
      if (!viewId.value || !currentImageID.value) return;
      volumeColoringStore.setColorPreset(
        viewId.value,
        currentImageID.value,
        name
      );
    };

    return {
      presetUnavailableReason,
      presetDescription: getAdaptiveVolumePresetDescription,
      thumbnails: currentThumbnails,
      hasCurrentImage,
      preset: selectedPreset,
      presetList: PresetNameList,
      size: THUMBNAIL_SIZE,
      selectPreset,
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
              'opacity-50': !!presetUnavailableReason(preset),
            }"
            :data-testid="`volume-preset-${preset}`"
            :title="
              presetUnavailableReason(preset) || presetDescription(preset)
            "
            :aria-disabled="!!presetUnavailableReason(preset)"
            :tabindex="presetUnavailableReason(preset) ? -1 : 0"
            role="button"
            @click="!presetUnavailableReason(preset) && select()"
            @keydown.enter="!presetUnavailableReason(preset) && select()"
            @keydown.space.prevent="
              !presetUnavailableReason(preset) && select()
            "
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
