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
    const panel = ref(['auto']);
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

    // --- Automatic Range Options --- //

    const filteredWLAutoRanges = computed(
      () =>
        Object.fromEntries(
          Object.entries(WLAutoRanges).filter(([, value]) => value !== 0)
        ) as Record<string, number>
    );

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
        if (config?.auto && config.auto !== WL_AUTO_DEFAULT) {
          return config.auto;
        }
        return { width: wlWidth.value, level: wlLevel.value };
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
          return { width: val, level: levels[idx] };
        });
      }
      return [];
    });

    // --- Reset --- //

    const resetWindowLevel = () => {
      const imageID = currentImageID.value;
      // All views will be synchronized, just reset the first
      const viewID = viewIDs.value[0];
      if (!imageID || !viewID) return;
      windowingStore.updateConfig(viewID, imageID, {
        preset: wlDefaults.value,
        auto: WL_AUTO_DEFAULT,
      });
      windowingStore.resetWindowLevel(viewID, imageID);
    };

    return {
      resetWindowLevel,
      parseLabel,
      wlOptions,
      WLPresetsCT,
      isCT,
      tags,
      panel,
      filteredWLAutoRanges,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text>
      <v-expansion-panels v-model="panel" multiple>
        <v-expansion-panel v-if="isCT">
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
                v-for="(value, idx) in tags"
                :key="idx"
                :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
                :value="value"
                density="compact"
              />
              <v-radio
                v-for="(value, key) in filteredWLAutoRanges"
                :key="key"
                :label="`${parseLabel(key)} (${0 + value}, ${100 - value})`"
                :value="key"
                density="compact"
              />
            </v-radio-group>
            <v-btn
              prepend-icon="mdi-restore"
              variant="text"
              block
              @click="resetWindowLevel"
            >
              Reset
            </v-btn>
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
