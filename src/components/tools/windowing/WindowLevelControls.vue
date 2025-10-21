<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
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
    const panel = ref(['tags', 'presets', 'auto', 'manual']);

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

    const wlWidth = computed(() => wlConfig.value.width ?? 1);
    const wlLevel = computed(() => wlConfig.value.level ?? 0.5);

    const formatForDisplay = (value: number) => {
      const MIN_VALUE = 0.01;
      if (Math.abs(value) < MIN_VALUE) return 0;
      return Math.round(value * 100) / 100;
    };

    const displayWidth = computed({
      get: () => formatForDisplay(wlWidth.value),
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

    const displayLevel = computed({
      get: () => formatForDisplay(wlLevel.value),
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
      panel,
      WLAutoRanges,
      displayWidth,
      displayLevel,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text>
      <v-expansion-panels v-model="panel" multiple>
        <v-expansion-panel value="tags" v-if="tags.length">
          <v-expansion-panel-title>
            File Specific Presets
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <v-radio
                v-for="(value, idx) in tags"
                :key="idx"
                :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
                :value="value"
                density="compact"
              />
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel v-if="showCtPresets" value="presets">
          <v-expansion-panel-title>CT Presets</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <div v-for="(wl, name) in WLPresetsCT" :key="name">
                <v-radio
                  :key="name"
                  :label="parseLabel(name)"
                  :value="wl"
                  density="compact"
                  class="ml-3"
                />
              </div>
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel value="auto">
          <v-expansion-panel-title>Auto Window/Level</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <v-radio
                v-for="(value, key) in WLAutoRanges"
                :key="key"
                :label="parseLabel(key)"
                :value="key"
                density="compact"
              >
                <v-tooltip activator="parent" location="bottom">
                  {{
                    value
                      ? `Remove the top and bottom ${value} percent of data`
                      : 'Use the full data range'
                  }}
                </v-tooltip>
              </v-radio>
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel value="manual">
          <v-expansion-panel-title>Manual</v-expansion-panel-title>
          <v-expansion-panel-text>
            <div style="display: flex; gap: 8px; align-items: center;">
              <v-text-field
                v-model.number="displayWidth"
                label="Window"
                type="number"
                step="0.01"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model.number="displayLevel"
                label="Level"
                type="number"
                step="0.01"
                density="compact"
                hide-details
              />
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.v-card {
  max-width: 300px;
  max-height: 80vh;
  overflow-y: auto;
}
.v-expansion-panel-title {
  min-height: auto;
}
.v-expansion-panel-text:deep() .v-expansion-panel-text__wrapper {
  padding: 4px 6px 8px;
}

.v-selection-control:deep() .v-selection-control__input > .v-icon {
  font-size: 18px;
  align-self: center;
}
</style>
