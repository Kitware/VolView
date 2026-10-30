<script setup lang="ts">
import { computed } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import ColorDot from '@/src/components/ColorDot.vue';
import { EN_FACE_THICKNESS_HELP } from './thickness';
import type { EnFaceViewConfig, ThicknessControlState } from './store';

const props = defineProps<
  ThicknessControlState & { settings: EnFaceViewConfig; embedded?: boolean }
>();
const emit = defineEmits<{
  patch: [settings: Partial<EnFaceViewConfig>];
}>();
const thresholdReason = computed(
  () =>
    props.thicknessReason ||
    (!props.settings.highlightThin
      ? 'Enable thin-region highlighting to adjust the threshold.'
      : null)
);
function updateThreshold(value: string | number | null) {
  const parsed = Number(value);
  if (value !== null && value !== '' && Number.isFinite(parsed))
    emit('patch', { thresholdMicrons: Math.max(0, parsed) });
}
function updateSliderThreshold(value: number) {
  updateThreshold(Math.round(value * 10) / 10);
}
function updateSegment(selectedMaskId: string | null) {
  emit('patch', { selectedMaskId });
}
function updateHighlight(highlightThin: boolean | null) {
  emit('patch', { highlightThin: !!highlightThin });
}
</script>

<template>
  <v-expansion-panel bg-color="transparent" :class="{ embedded }">
    <v-expansion-panel-title
      class="section-title"
      :min-height="36"
      data-testid="enface-thickness-toggle"
      >Thickness highlighting</v-expansion-panel-title
    >
    <v-expansion-panel-text class="thickness-controls">
      <ReasonedAction :reason="highlightReason ?? undefined" block>
        <v-switch
          :model-value="settings.highlightThin"
          @update:model-value="updateHighlight"
          color="secondary"
          density="compact"
          hide-details
          :disabled="!!highlightReason"
          aria-label="Highlight thin regions"
          data-testid="enface-thin-highlight"
          label="Highlight thin regions"
        />
      </ReasonedAction>
      <ReasonedAction :reason="segmentationReason ?? undefined" block>
        <v-select
          :model-value="settings.selectedMaskId"
          @update:model-value="updateSegment"
          :items="segments"
          label="Thickness segment"
          :placeholder="
            segments.length ? undefined : 'No associated segmentation'
          "
          persistent-placeholder
          density="compact"
          variant="outlined"
          hide-details
          :disabled="!!segmentationReason"
          aria-label="Thickness segment"
          data-testid="enface-segmentation-segment"
        >
          <template #selection="{ item }">
            <span class="d-inline-flex align-center overflow-hidden">
              <ColorDot
                v-if="item.raw.color"
                :color="item.raw.color"
                class="mr-2 flex-shrink-0"
                aria-hidden="true"
                data-testid="enface-segment-color"
              />
              <span class="text-truncate">{{ item.title }}</span>
            </span>
          </template>
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps">
              <template #prepend>
                <ColorDot
                  v-if="item.raw.color"
                  :color="item.raw.color"
                  class="mr-2"
                  aria-hidden="true"
                  data-testid="enface-segment-option-color"
                />
              </template>
            </v-list-item>
          </template>
        </v-select>
      </ReasonedAction>
      <div class="threshold-heading">
        <span class="threshold-label text-body-2">
          Thickness below
          <ReasonedAction :tooltip="EN_FACE_THICKNESS_HELP" class="ml-1">
            <v-btn
              icon="mdi-information-outline"
              size="x-small"
              variant="text"
              aria-label="About thickness highlighting"
              data-testid="enface-thickness-help"
            />
          </ReasonedAction>
        </span>
        <ReasonedAction
          :reason="thresholdReason ?? undefined"
          class="threshold-value"
          block
        >
          <v-text-field
            :model-value="settings.thresholdMicrons"
            @update:model-value="updateThreshold"
            type="number"
            min="0"
            step="any"
            suffix="µm"
            density="compact"
            variant="outlined"
            hide-details
            :disabled="!!thresholdReason"
            aria-label="Thickness threshold in micrometers"
            data-testid="enface-thickness-threshold-input"
          />
        </ReasonedAction>
      </div>
      <ReasonedAction :reason="thresholdReason ?? undefined" block>
        <v-slider
          :model-value="Math.min(settings.thresholdMicrons, thresholdMaximum)"
          @update:model-value="updateSliderThreshold"
          min="0"
          :max="thresholdMaximum"
          :step="0"
          density="compact"
          hide-details
          :disabled="!!thresholdReason"
          name="Thickness threshold in micrometers"
          data-testid="enface-thickness-threshold"
        />
      </ReasonedAction>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.section-title {
  padding: 0 4px;
  font-size: 0.8125rem;
}
.threshold-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}
.embedded .threshold-heading {
  flex-wrap: wrap;
}
.threshold-label {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.threshold-value {
  width: 112px;
  flex: 0 0 112px;
}
/* Outranks the parent's section padding regardless of stylesheet order. */
.v-expansion-panel-text.thickness-controls
  :deep(.v-expansion-panel-text__wrapper) {
  padding-top: 0;
}
:deep(.v-switch .v-label) {
  font-size: 0.875rem;
}
</style>
