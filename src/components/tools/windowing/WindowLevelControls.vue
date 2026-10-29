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
  props: {
    viewId: String,
    imageId: String,
  },
  emits: ['change'],
  setup(props, { emit }) {
    const { currentImageID } = useCurrentImage();
    const windowingStore = useWindowingStore();
    const viewStore = useViewStore();
    const dicomStore = useDICOMStore();
    const { activeView } = storeToRefs(viewStore);
    const targetViewID = computed(() => props.viewId ?? activeView.value);
    const targetImageID = computed(() => props.imageId ?? currentImageID.value);

    function parseLabel(text: string) {
      return text.replace(/([A-Z])/g, ' $1').trim();
    }

    // --- CT Preset Options --- //

    const modality = computed(() => {
      if (targetImageID.value && isDicomImage(targetImageID.value)) {
        const volKey = targetImageID.value;
        const { Modality } = dicomStore.volumeInfo[volKey];
        return Modality;
      }
      return '';
    });

    const ctTags = ['ct', 'ctprotocol'];

    const showCtPresets = computed(() => {
      if (targetImageID.value && !isDicomImage(targetImageID.value)) {
        return true;
      }
      return modality.value && ctTags.includes(modality.value.toLowerCase());
    });

    // --- UI Selection Management --- //

    type AutoRangeKey = keyof typeof WLAutoRanges;
    type PresetValue = { width: number; level: number };

    const wlConfig = computed(() => {
      const viewID = targetViewID.value;
      const imageID = targetImageID.value;
      if (!imageID || !viewID) return defaultWindowLevelConfig();
      return windowingStore.getConfig(viewID, imageID);
    });

    const wlWidth = computed(() => wlConfig.value.width ?? 1);
    const wlLevel = computed(() => wlConfig.value.level ?? 0.5);

    const manualField = (field: 'width' | 'level') => {
      const editing = ref(false);
      // Preserve incomplete decimal and exponent entries until the field loses focus.
      const draft = ref('');
      const value = computed({
        get: () =>
          editing.value ? draft.value : String(wlConfig.value[field]),
        set: (text: string) => {
          draft.value = text;
          const parsed = Number(text);
          const imageID = targetImageID.value;
          const viewID = targetViewID.value;
          if (!imageID || !viewID || !text.trim() || !Number.isFinite(parsed))
            return;
          windowingStore.updateConfig(
            viewID,
            imageID,
            {
              width: wlWidth.value,
              level: wlLevel.value,
              [field]: parsed,
            },
            true
          );
          emit('change');
        },
      });
      return {
        value,
        begin: () => {
          draft.value = String(wlConfig.value[field]);
          editing.value = true;
        },
        end: () => {
          editing.value = false;
        },
      };
    };
    const widthField = manualField('width');
    const levelField = manualField('level');
    const displayWidth = widthField.value;
    const displayLevel = levelField.value;

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
        const imageID = targetImageID.value;
        const viewID = targetViewID.value;
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

    function resetContrast() {
      const viewID = targetViewID.value;
      const imageID = targetImageID.value;
      if (!viewID || !imageID) return;
      windowingStore.resetContrast(viewID, imageID);
      emit('change');
    }

    // --- Tag WL Options --- //
    const tags = computed(() => {
      if (targetImageID.value && isDicomImage(targetImageID.value)) {
        const volKey = targetImageID.value;
        return getWindowLevels(dicomStore.volumeInfo[volKey]);
      }
      return [];
    });

    return {
      parseLabel,
      resetContrast,
      targetViewID,
      targetImageID,
      wlOptions,
      WLPresetsCT,
      showCtPresets,
      tags,
      WLAutoRanges,
      widthField,
      levelField,
      displayWidth,
      displayLevel,
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
              @click="$emit('change')"
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
              @click="$emit('change')"
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
            @click="$emit('change')"
          />
        </div>
      </v-radio-group>

      <v-card-subtitle class="pb-1">Manual</v-card-subtitle>
      <div class="px-4 pb-3">
        <div class="manual-inputs">
          <v-text-field
            v-model="displayWidth"
            @focus="widthField.begin"
            @blur="widthField.end"
            label="Window"
            type="number"
            variant="underlined"
            density="compact"
            hide-details
          />
          <v-text-field
            v-model="displayLevel"
            @focus="levelField.begin"
            @blur="levelField.end"
            label="Level"
            type="number"
            variant="underlined"
            density="compact"
            hide-details
          />
        </div>
      </div>
      <div class="px-4 pb-3">
        <v-btn
          block
          variant="tonal"
          prepend-icon="mdi-restore"
          :disabled="!targetViewID || !targetImageID"
          data-testid="reset-contrast"
          @click="resetContrast"
        >
          Reset contrast
          <v-tooltip activator="parent" location="top">
            Restore the default contrast for this view.
          </v-tooltip>
        </v-btn>
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
