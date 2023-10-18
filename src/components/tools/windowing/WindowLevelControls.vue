<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import useWindowingStore, {
  defaultWindowLevelConfig,
} from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { WLAutoRanges, WLPresetsCT, WL_AUTO_DEFAULT } from '@/src/constants';
import { useDICOMStore } from '@/src/store/datasets-dicom';

export default defineComponent({
  setup() {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();
    const dicomStore = useDICOMStore();
    const panel = ref(['tags', 'presets']);
    const windowingDefaults = defaultWindowLevelConfig();

    // Get the relevant view ids
    const viewIDs = computed(() =>
      viewStore.viewIDs.filter(
        (viewID) => !!windowingStore.getConfig(viewID, currentImageID.value)
      )
    );

    function parseLabel(text: string) {
      return text.replace(/([A-Z])/g, ' $1').trim();
    }

    // --- CT Preset Options --- //

    const modality = computed(() => {
      if (
        currentImageID.value &&
        currentImageID.value in dicomStore.imageIDToVolumeKey
      ) {
        const volKey = dicomStore.imageIDToVolumeKey[currentImageID.value];
        const { Modality } = dicomStore.volumeInfo[volKey];
        return Modality;
      }
      return '';
    });
    const isCT = computed(() => {
      const ctTags = ['ct', 'ctprotocol'];
      return modality.value && ctTags.includes(modality.value.toLowerCase());
    });

    const wlDefaults = computed(() => {
      return { width: windowingDefaults.width, level: windowingDefaults.level };
    });

    // --- UI Selection Management --- //

    type AutoRangeKey = keyof typeof WLAutoRanges;
    type PresetValue = { width: number; level: number };

    const wlConfig = computed(() => {
      // All views will have the same settings, just grab the first
      const viewID = viewIDs.value[0];
      const imageID = currentImageID.value;
      if (!imageID || !viewID) return windowingDefaults;
      return windowingStore.getConfig(viewID, imageID);
    });

    const wlWidth = computed(
      () => wlConfig.value?.width ?? wlDefaults.value.width
    );
    const wlLevel = computed(
      () => wlConfig.value?.level ?? wlDefaults.value.level
    );

    const wlOptions = computed({
      get() {
        const config = wlConfig.value;
        const { width, level } = config?.preset || wlDefaults.value;
        const { width: defaultWidth, level: defaultLevel } = wlDefaults.value;
        if (width !== defaultWidth && level !== defaultLevel) {
          return { width: wlWidth.value, level: wlLevel.value };
        }
        return config?.auto || WL_AUTO_DEFAULT;
      },
      set(selection: AutoRangeKey | PresetValue) {
        const imageID = currentImageID.value;
        // All views will be synchronized, just set the first
        const viewID = viewIDs.value[0];
        if (imageID && viewID) {
          const useAuto = typeof selection !== 'object';
          const newValue = {
            preset: useAuto ? wlDefaults.value : selection,
            auto: useAuto ? selection : WL_AUTO_DEFAULT,
          };
          windowingStore.updateConfig(viewID, imageID, newValue);
          windowingStore.resetWindowLevel(viewID, imageID);
        }
      },
    });

    // --- Tag WL Options --- //

    function parseTags(text: string) {
      return text.split('\\');
    }

    const tags = computed(() => {
      if (
        currentImageID.value &&
        currentImageID.value in dicomStore.imageIDToVolumeKey
      ) {
        const volKey = dicomStore.imageIDToVolumeKey[currentImageID.value];
        const { WindowWidth, WindowLevel } = dicomStore.volumeInfo[volKey];
        const levels = parseTags(WindowLevel);
        return parseTags(WindowWidth).map((val, idx) => {
          return { width: parseFloat(val), level: parseFloat(levels[idx]) };
        });
      }
      return [];
    });

    return {
      parseLabel,
      wlOptions,
      WLPresetsCT,
      isCT,
      tags,
      panel,
      WLAutoRanges,
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
            Data-Specific Presets
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
        <v-expansion-panel v-if="isCT" value="presets">
          <v-expansion-panel-title>Presets</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlOptions" hide-details>
              <template v-if="isCT">
                <p>CT Presets</p>
                <hr />
                <div v-for="(options, category) in WLPresetsCT" :key="category">
                  <p>{{ parseLabel(category) }}</p>
                  <v-radio
                    v-for="(value, key) in options"
                    :key="key"
                    :label="parseLabel(key)"
                    :value="value"
                    density="compact"
                    class="ml-3"
                  />
                </div>
              </template>
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
      </v-expansion-panels>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.v-card {
  max-width: 300px;
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
