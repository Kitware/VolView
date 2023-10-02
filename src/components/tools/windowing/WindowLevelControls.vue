<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import useWindowingStore, {
  defaultWindowLevelConfig,
} from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { WLAutoRanges, WLPresetsCT } from '@/src/constants';
import { useDICOMStore } from '@/src/store/datasets-dicom';

export default defineComponent({
  setup() {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();
    const dicomStore = useDICOMStore();

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
        return config?.auto || 'Default';
      },
      set(selection: string) {
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

    const wlPresetSettings = computed({
      get() {
        // All views will have the same setting, just grab the first
        const viewID = viewIDs.value[0];
        const config = windowingStore.getConfig(viewID, currentImageID.value);
        return config?.preset || { width: 1, level: 0.5 };
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

    const resetPreset = () => {
      const { width, level } = defaultWindowLevelConfig();
      wlPresetSettings.value = { width, level };
      resetWindowLevel();
    };

    return {
      resetWindowLevel,
      resetPreset,
      WLAutoRanges,
      wlAutoSettings,
      parseLabel,
      wlPresetSettings,
      WLPresetsCT,
      isCT,
      tags,
    };
  },
});
</script>

<template>
  <v-card dark>
    <v-card-text>
      <v-radio-group v-if="isCT" v-model="wlPresetSettings" hide-details>
        <p>CT Presets</p>
        <hr />
        <div
          v-for="(options, category) in WLPresetsCT"
          :key="category"
          class="ml-3"
        >
          <p>{{ parseLabel(category) }}</p>
          <v-radio
            v-for="(value, key) in options"
            :key="key"
            :label="`${key} [W:${value['width']},L:${value['level']}]`"
            :value="value"
            density="compact"
          />
        </div>
        <v-btn
          prepend-icon="mdi-restore"
          variant="text"
          block
          @click="resetPreset"
        >
          Reset Preset
        </v-btn>
      </v-radio-group>
      <v-radio-group v-if="tags.length" v-model="wlPresetSettings" hide-details>
        <p>Tags</p>
        <hr />
        <v-radio
          v-for="(value, idx) in tags"
          :key="idx"
          :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
          :value="value"
          density="compact"
        />
      </v-radio-group>
      <v-radio-group v-model="wlAutoSettings" hide-details>
        <p>Auto</p>
        <hr />
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
        Reset Auto
      </v-btn>
    </v-card-text>
  </v-card>
</template>
