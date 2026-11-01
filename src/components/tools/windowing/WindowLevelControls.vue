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
import { useEnFaceViewStore } from '@/src/enface/store';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

export default defineComponent({
  components: { ReasonedAction },
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
    const enFaceStore = useEnFaceViewStore();
    const { activeView } = storeToRefs(viewStore);
    const targetViewID = computed(() => props.viewId ?? activeView.value);
    const targetImageID = computed(() => props.imageId ?? currentImageID.value);
    const isSumProjection = computed(() => {
      const viewID = targetViewID.value;
      const imageID = targetImageID.value;
      return (
        !!viewID &&
        !!imageID &&
        viewStore.getView(viewID)?.type === 'EnFace' &&
        enFaceStore.settingsFor(viewID, imageID).method === 'sum'
      );
    });

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
      const currentValue = computed(() =>
        field === 'width' ? wlWidth.value : wlLevel.value
      );
      const editing = ref(false);
      // Preserve incomplete decimal and exponent entries until the field loses focus.
      const draft = ref('');
      const value = computed({
        get: () =>
          editing.value
            ? draft.value
            : String(Number(currentValue.value.toPrecision(4))),
        set: (text: string) => {
          draft.value = text;
          const parsed = Number(text);
          const imageID = targetImageID.value;
          const viewID = targetViewID.value;
          if (
            !imageID ||
            !viewID ||
            !text.trim() ||
            !Number.isFinite(parsed) ||
            (field === 'width' && parsed <= 0)
          )
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
          draft.value = String(currentValue.value);
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
      resetContrastReason: computed(() => {
        if (!targetViewID.value) return 'Select a view to reset contrast.';
        if (!targetImageID.value)
          return 'Load an image in this view to reset contrast.';
        return '';
      }),
      wlOptions,
      WLPresetsCT,
      showCtPresets,
      tags,
      sourcePresetReason: computed(() =>
        isSumProjection.value
          ? 'Source intensity presets do not apply to Sum projections. Use Auto Window/Level or Manual instead.'
          : ''
      ),
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
        <ReasonedAction
          v-if="tags.length"
          :reason="sourcePresetReason"
          block
          v-slot="{ disabled }"
        >
          <v-card-subtitle class="py-1">File Specific Presets</v-card-subtitle>
          <div class="px-4 pb-2">
            <v-radio
              v-for="(value, idx) in tags"
              :key="idx"
              :label="`Tag ${idx + 1} [W:${value.width},L:${value.level}]`"
              :value="value"
              :disabled="disabled"
              density="compact"
              @click="$emit('change')"
            />
          </div>
        </ReasonedAction>

        <ReasonedAction
          v-if="showCtPresets"
          :reason="sourcePresetReason"
          block
          v-slot="{ disabled }"
        >
          <v-card-subtitle class="pb-1">CT Presets</v-card-subtitle>
          <div class="px-4 pb-2">
            <v-radio
              v-for="(wl, name) in WLPresetsCT"
              :key="name"
              :label="parseLabel(name)"
              :value="wl"
              :disabled="disabled"
              density="compact"
              @click="$emit('change')"
            />
          </div>
        </ReasonedAction>

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
        <ReasonedAction
          :reason="resetContrastReason"
          tooltip="Restore the default contrast for this view."
          block
          v-slot="{ disabled }"
        >
          <v-btn
            block
            variant="tonal"
            prepend-icon="mdi-restore"
            :disabled="disabled"
            data-testid="reset-contrast"
            @click="resetContrast"
          >
            Reset contrast
          </v-btn>
        </ReasonedAction>
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
