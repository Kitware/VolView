<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import type { OCTViewConfig } from './store';

const props = defineProps<{
  settings: OCTViewConfig;
  depthMaximum: number;
  projectionReason: string | null;
  segmentationReason: string | null;
  thicknessReason: string | null;
  segments: { value: string; title: string }[];
}>();
const emit = defineEmits<{ patch: [settings: Partial<OCTViewConfig>] }>();
const thresholdReason = computed(
  () =>
    props.thicknessReason ||
    (!props.settings.highlightThin
      ? 'Enable thin-region highlighting to adjust the threshold.'
      : null)
);
const projectionMethods = [
  { title: 'Mean', value: 'mean' },
  { title: 'Maximum', value: 'max' },
  { title: 'Sum', value: 'sum' },
];
const projectionLabel = computed(
  () =>
    projectionMethods.find(({ value }) => value === props.settings.method)
      ?.title ?? 'Mean'
);
const axes = [
  { title: 'X (columns)', value: 0 },
  { title: 'Y (rows)', value: 1 },
  { title: 'Z (frames)', value: 2 },
];
const depthStartDraft = ref<string | number | null>(null);
const depthEndDraft = ref<string | number | null>(null);
function syncDepthDrafts() {
  depthStartDraft.value = props.settings.depthStart;
  depthEndDraft.value = props.settings.depthEnd ?? props.depthMaximum;
}
watch(
  [
    () => props.settings.depthStart,
    () => props.settings.depthEnd,
    () => props.depthMaximum,
  ],
  syncDepthDrafts,
  { immediate: true }
);

function commitDepth(field: 'depthStart' | 'depthEnd') {
  const draft =
    field === 'depthStart' ? depthStartDraft.value : depthEndDraft.value;
  const parsed = Number(draft);
  if (draft === null || draft === '' || !Number.isFinite(parsed)) {
    syncDepthDrafts();
    return;
  }
  const value = Math.min(props.depthMaximum, Math.max(0, Math.round(parsed)));
  const patch: Partial<OCTViewConfig> = { [field]: value };
  if (
    field === 'depthStart' &&
    value > (props.settings.depthEnd ?? props.depthMaximum)
  )
    patch.depthEnd = value;
  if (field === 'depthEnd' && value < props.settings.depthStart)
    patch.depthStart = value;
  emit('patch', patch);
}
function updateThreshold(value: string | number | null) {
  const parsed = Number(value);
  if (value !== null && value !== '' && Number.isFinite(parsed))
    emit('patch', { thresholdMicrons: Math.max(0, parsed) });
}
function updateSliderThreshold(value: number) {
  updateThreshold(Math.round(value * 10) / 10);
}
function updateMethod(method: string) {
  if (method === 'mean' || method === 'max' || method === 'sum')
    emit('patch', { method });
}
function updateAxis(axis: number) {
  if (axis === 0 || axis === 1 || axis === 2)
    emit('patch', { axis, depthStart: 0, depthEnd: null });
}
function updateSegment(selectedMaskId: string | null) {
  emit('patch', { selectedMaskId });
}
function updateHighlight(highlightThin: boolean | null) {
  emit('patch', { highlightThin: !!highlightThin });
}
</script>

<template>
  <v-card
    class="en-face-controls"
    width="300"
    rounded="lg"
    data-testid="oct-rendering-panel"
  >
    <v-card-title class="controls-title">
      <span>En face</span>
      <v-chip size="x-small" variant="tonal" class="projection-chip"
        >{{ projectionLabel }} projection</v-chip
      >
    </v-card-title>
    <v-card-text class="pt-0 pb-3">
      <ReasonedAction :reason="segmentationReason ?? undefined" block>
        <v-select
          :model-value="settings.selectedMaskId"
          @update:model-value="updateSegment"
          :items="segments"
          label="Segment"
          :placeholder="
            segments.length ? undefined : 'No associated segmentation'
          "
          persistent-placeholder
          density="compact"
          variant="outlined"
          hide-details
          :disabled="!!segmentationReason"
          aria-label="OCT segment"
          data-testid="oct-segmentation-segment"
        />
      </ReasonedAction>
      <ReasonedAction :reason="thicknessReason ?? undefined" block>
        <v-switch
          :model-value="settings.highlightThin"
          @update:model-value="updateHighlight"
          label="Highlight thin regions"
          color="amber-lighten-2"
          inset
          density="compact"
          hide-details
          :disabled="!!thicknessReason"
          aria-label="Highlight thin OCT regions"
          data-testid="oct-thin-highlight"
        />
      </ReasonedAction>
      <div class="threshold-heading">
        <span class="text-body-2">Thickness below</span>
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
            aria-label="OCT thickness threshold in micrometers"
            data-testid="oct-thickness-threshold-input"
          />
        </ReasonedAction>
      </div>
      <ReasonedAction :reason="thresholdReason ?? undefined" block>
        <v-slider
          :model-value="settings.thresholdMicrons"
          @update:model-value="updateSliderThreshold"
          min="0"
          :max="Math.max(500, settings.thresholdMicrons)"
          :step="0"
          :thumb-size="14"
          :track-size="4"
          color="amber-lighten-2"
          hide-details
          :disabled="!!thresholdReason"
          aria-label="OCT thickness threshold"
          data-testid="oct-thickness-threshold"
        />
      </ReasonedAction>
      <v-divider class="mt-1 mb-1" />
      <v-expansion-panels variant="accordion" flat class="advanced-controls">
        <v-expansion-panel bg-color="transparent">
          <v-expansion-panel-title
            class="advanced-title"
            :min-height="36"
            data-testid="oct-advanced-toggle"
            >Advanced</v-expansion-panel-title
          >
          <v-expansion-panel-text>
            <ReasonedAction :reason="projectionReason ?? undefined" block>
              <v-select
                :model-value="settings.method"
                @update:model-value="updateMethod"
                :items="projectionMethods"
                label="Projection"
                density="compact"
                variant="outlined"
                hide-details
                class="mb-3"
                :disabled="!!projectionReason"
                aria-label="En face projection method"
                data-testid="oct-projection-method"
              />
            </ReasonedAction>
            <ReasonedAction :reason="projectionReason ?? undefined" block>
              <v-select
                :model-value="settings.axis"
                @update:model-value="updateAxis"
                :items="axes"
                label="A-line axis"
                density="compact"
                variant="outlined"
                hide-details
                class="mb-3"
                :disabled="!!projectionReason"
                aria-label="OCT A-line axis"
                data-testid="oct-projection-axis"
              />
            </ReasonedAction>
            <div class="slab-fields">
              <ReasonedAction
                :reason="projectionReason ?? undefined"
                tooltip="First A-line sample index, included in the projection."
                block
              >
                <v-text-field
                  v-model="depthStartDraft"
                  @change="commitDepth('depthStart')"
                  label="Slab start"
                  type="number"
                  min="0"
                  :max="depthMaximum"
                  step="1"
                  density="compact"
                  variant="outlined"
                  hide-details
                  :disabled="!!projectionReason"
                  aria-label="En face slab start"
                  data-testid="oct-slab-start"
                />
              </ReasonedAction>
              <ReasonedAction
                :reason="projectionReason ?? undefined"
                tooltip="Last A-line sample index, included in the projection."
                block
              >
                <v-text-field
                  v-model="depthEndDraft"
                  @change="commitDepth('depthEnd')"
                  label="Slab end"
                  type="number"
                  min="0"
                  :max="depthMaximum"
                  step="1"
                  density="compact"
                  variant="outlined"
                  hide-details
                  :disabled="!!projectionReason"
                  aria-label="En face slab end"
                  data-testid="oct-slab-end"
                />
              </ReasonedAction>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.en-face-controls {
  max-height: min(560px, 80vh);
  overflow-y: auto;
}
.controls-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 1rem;
  padding: 12px 16px;
}
.projection-chip {
  font-weight: 400;
  letter-spacing: normal;
}
.threshold-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
}
.threshold-value {
  width: 112px;
  flex: 0 0 112px;
}
.slab-fields {
  display: flex;
  gap: 8px;
}
.slab-fields > * {
  flex: 1;
  min-width: 0;
}
.advanced-title {
  padding: 0 4px;
  font-size: 0.8125rem;
}
.advanced-controls :deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 0 0;
}
.en-face-controls :deep(.v-switch .v-label) {
  font-size: 0.875rem;
}
.en-face-controls :deep(.v-field__input) {
  font-size: 0.875rem;
}
</style>
