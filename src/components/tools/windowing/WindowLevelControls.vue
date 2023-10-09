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
    const panel = ref([1]);
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
    const wlAutoSettings = computed({
      get() {
        // All views will have the same setting, just grab the first
        const viewID = viewIDs.value[0];
        const config = windowingStore.getConfig(viewID, currentImageID.value);
        return config?.auto || WL_AUTO_DEFAULT;
      },
      set(selection: keyof typeof WLAutoRanges) {
        const imageID = currentImageID.value;
        if (imageID) {
          viewIDs.value.map((viewID) =>
            windowingStore.updateConfig(viewID, imageID, {
              auto: selection,
            })
          );
        }
      },
    });

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
    const isCT = computed(
      () =>
        modality.value &&
        ['ct', 'ctprotocol'].includes(modality.value.toLowerCase())
    );

    const wlDefaults = computed(() => {
      return { width: windowingDefaults.width, level: windowingDefaults.level };
    });

    const wlPresetSettings = computed({
      get() {
        // All views will have the same setting, just grab the first
        const viewID = viewIDs.value[0];
        const config = windowingStore.getConfig(viewID, currentImageID.value);
        return config?.preset || wlDefaults.value;
      },
      set(selection: { width: number; level: number }) {
        const imageID = currentImageID.value;
        if (imageID) {
          viewIDs.value.forEach((viewID) => {
            windowingStore.updateConfig(viewID, imageID, { preset: selection });
            windowingStore.resetWindowLevel(viewID, imageID);
          });
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
      if (!imageID) return;
      // Reset the window/level for all views
      viewIDs.value.forEach((viewID) =>
        windowingStore.resetWindowLevel(viewID, imageID)
      );
    };

    return {
      resetWindowLevel,
      WLAutoRanges,
      wlAutoSettings,
      parseLabel,
      wlPresetSettings,
      WLPresetsCT,
      isCT,
      tags,
      panel,
      wlDefaults,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text>
      <v-expansion-panels v-model="panel" multiple>
        <v-expansion-panel :disabled="!isCT && !tags.length">
          <v-expansion-panel-title>Presets & Tags</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlPresetSettings" hide-details>
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
              <p>Tags</p>
              <hr />
              <v-radio
                v-for="(value, idx) in tags"
                :key="idx"
                :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
                :value="value"
                density="compact"
                class="ml-3"
              />
              <p>Default</p>
              <hr />
              <v-radio
                label="Default Width/Level"
                :value="wlDefaults"
                density="compact"
              />
            </v-radio-group>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel>
          <v-expansion-panel-title>Auto Window/Level</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-radio-group v-model="wlAutoSettings" hide-details>
              <v-radio
                v-for="(value, key) in WLAutoRanges"
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
