<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  useWindowingStore,
  defaultWindowLevelConfig,
} from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { WLAutoRanges, WLPresetsCT } from '@/src/constants';
import { getWindowLevels, useDICOMStore } from '@/src/store/datasets-dicom';
import { isDicomImage } from '@/src/utils/dataSelection';
import { storeToRefs } from 'pinia';

export default defineComponent({
  setup() {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();
    const dicomStore = useDICOMStore();
    const { activeView } = storeToRefs(viewStore);

    function parseLabel(text: string) {
      return text.replace(/([A-Z])/g, ' $1').trim();
    }

    // --- CT Preset Options --- //

    const modality = computed(() => {
      if (currentImageID.value && isDicomImage(currentImageID.value)) {
        const volKey = currentImageID.value;
        const { Modality } = dicomStore.volumeInfo[volKey];
        return Modality;
      }
      return '';
    });

    const ctTags = ['ct', 'ctprotocol'];
    const showCtPresets = computed(() => {
      if (currentImageID.value && !isDicomImage(currentImageID.value)) {
        return true;
      }
      return modality.value && ctTags.includes(modality.value.toLowerCase());
    });

    // --- UI Selection Management --- //

    type AutoRangeKey = keyof typeof WLAutoRanges;
    type PresetValue = { width: number; level: number };

    const wlConfig = computed(() => {
      // All views will have the same settings, just grab the first
      const viewID = activeView.value;
      const imageID = currentImageID.value;
      if (!imageID || !viewID) return defaultWindowLevelConfig();
      return (
        windowingStore.getConfig(viewID, imageID) ?? defaultWindowLevelConfig()
      );
    });

    const wlWidth = computed(() => wlConfig.value.width);
    const wlLevel = computed(() => wlConfig.value.level);

    const manualWidth = computed({
      get: () => wlWidth.value,
      set: (value: number) => {
        const imageID = currentImageID.value;
        const viewID = activeView.value;
        if (!imageID || !viewID || !Number.isFinite(value)) return;
        windowingStore.updateConfig(
          viewID,
          imageID,
          { width: value, level: wlLevel.value },
          true
        );
      },
    });

    const manualLevel = computed({
      get: () => wlLevel.value,
      set: (value: number) => {
        const imageID = currentImageID.value;
        const viewID = activeView.value;
        if (!imageID || !viewID || !Number.isFinite(value)) return;
        windowingStore.updateConfig(
          viewID,
          imageID,
          { width: wlWidth.value, level: value },
          true
        );
      },
    });

    const wlOptions = computed({
      get() {
        const config = wlConfig.value;
        if (config.useAuto) {
          return config.auto;
        }
        // Otherwise, a specific W/L is active (from preset or manual adjustment).
        return { width: wlWidth.value, level: wlLevel.value };
      },
      set(selection: AutoRangeKey | PresetValue) {
        const imageID = currentImageID.value;
        const viewID = activeView.value;
        if (!imageID || !viewID) {
          return;
        }

        if (typeof selection === 'object') {
          windowingStore.updateConfig(
            viewID,
            imageID,
            {
              width: selection.width,
              level: selection.level,
            },
            true
          );
          return;
        }

        windowingStore.updateConfig(
          viewID,
          imageID,
          {
            auto: selection,
          },
          true
        );
      },
    });

    // --- Tag WL Options --- //
    const tags = computed(() => {
      if (currentImageID.value && isDicomImage(currentImageID.value)) {
        const volKey = currentImageID.value;
        return getWindowLevels(dicomStore.volumeInfo[volKey]);
      }
      return [];
    });

    return {
      parseLabel,
      wlOptions,
      WLPresetsCT,
      showCtPresets,
      tags,
      WLAutoRanges,
      manualWidth,
      manualLevel,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text class="pa-0">
      <v-radio-group v-model="wlOptions" hide-details>
        <template v-if="tags.length">
          <v-card-subtitle class="py-1">File Specific Presets</v-card-subtitle>
          <div class="px-4 pb-2">
            <v-radio
              v-for="(value, idx) in tags"
              :key="idx"
              :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
              :value="value"
              density="compact"
            />
          </div>
        </template>

        <template v-if="showCtPresets">
          <v-card-subtitle class="pb-1">CT Presets</v-card-subtitle>
          <div class="px-4 pb-2">
            <v-radio
              v-for="(wl, name) in WLPresetsCT"
              :key="name"
              :label="parseLabel(name)"
              :value="wl"
              density="compact"
            />
          </div>
        </template>

        <v-card-subtitle class="pb-1">Auto Window/Level</v-card-subtitle>
        <div class="px-4 pb-2">
          <v-radio
            v-for="(value, key) in WLAutoRanges"
            :key="key"
            :label="parseLabel(key)"
            :value="key"
            density="compact"
          />
        </div>
      </v-radio-group>

      <v-card-subtitle class="pb-1">Manual</v-card-subtitle>
      <div class="px-4 pb-3">
        <div class="manual-inputs">
          <v-text-field
            v-model.number="manualWidth"
            label="Window"
            type="number"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model.number="manualLevel"
            label="Level"
            type="number"
            density="compact"
            hide-details
          />
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.v-card {
  max-width: 280px;
  max-height: 80vh;
  overflow-y: auto;
}

.v-card-subtitle {
  font-size: 1rem;
  opacity: 1;
}

.manual-inputs {
  display: flex;
  gap: 8px;
}

.v-selection-control:deep() .v-selection-control__input > .v-icon {
  font-size: 18px;
  align-self: center;
}
</style>
