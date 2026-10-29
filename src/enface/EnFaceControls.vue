<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import ColorDot from '@/src/components/ColorDot.vue';
import { EN_FACE_THICKNESS_HELP } from './thickness';
import type { EnFaceViewConfig, EnFaceViewControlState } from './store';

const props = defineProps<
  EnFaceViewControlState & { settings: EnFaceViewConfig; embedded?: boolean }
>();
const emit = defineEmits<{
  patch: [settings: Partial<EnFaceViewConfig>];
}>();
const expandedSections = ref([0, 1]);
const slabDraft = ref<number[] | null>(null);
watch(
  () => [
    props.settings.axis,
    props.settings.depthStart,
    props.settings.depthEnd,
    props.depthMaximum,
  ],
  () => {
    slabDraft.value = null;
  }
);
const segmentReason = computed(
  () =>
    props.segmentationReason ||
    (!props.settings.highlightThin
      ? 'Enable thin-region highlighting to choose a segment.'
      : null)
);
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
// VRangeSlider does not expose separate accessible names for its thumbs.
const vSlabLabels = (element: HTMLElement) => {
  element.querySelectorAll('[role="slider"]').forEach((thumb, index) => {
    thumb.setAttribute('aria-label', index === 0 ? 'Slab start' : 'Slab end');
  });
};
function updateSlab([depthStart, depthEnd]: number[]) {
  slabDraft.value = null;
  emit('patch', { depthStart, depthEnd });
}
function applyKeyboardSlab() {
  // Thumb key handlers update the draft before the event bubbles here.
  if (slabDraft.value) updateSlab(slabDraft.value);
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
    :class="{ embedded }"
    :width="embedded ? '100%' : 300"
    :rounded="embedded ? 0 : 'lg'"
    :flat="embedded"
    data-testid="oct-rendering-panel"
    @dblclick.stop
  >
    <v-card-title v-if="!embedded" class="controls-title">En face</v-card-title>
    <v-card-text class="pt-0 pb-3">
      <v-expansion-panels
        v-model="expandedSections"
        multiple
        variant="accordion"
        flat
        class="control-sections"
      >
        <v-expansion-panel bg-color="transparent">
          <v-expansion-panel-title
            class="section-title"
            :min-height="36"
            data-testid="oct-projection-toggle"
            >Projection</v-expansion-panel-title
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
            <ReasonedAction
              :reason="projectionReason ?? undefined"
              tooltip="Uses the volume orientation shown in the slice views. Scan coordinates may not be patient-aligned."
              block
            >
              <v-select
                :model-value="settings.axis"
                @update:model-value="updateAxis"
                :items="axes"
                label="Projection axis"
                density="compact"
                variant="outlined"
                hide-details
                class="mb-3"
                :disabled="!!projectionReason"
                aria-label="Projection axis"
                data-testid="oct-projection-axis"
              />
            </ReasonedAction>
            <ReasonedAction :reason="projectionReason ?? undefined" block>
              <v-range-slider
                v-slab-labels
                :model-value="
                  slabDraft ?? [
                    settings.depthStart,
                    settings.depthEnd ?? depthMaximum,
                  ]
                "
                @update:model-value="slabDraft = $event"
                @end="updateSlab"
                @keydown="applyKeyboardSlab"
                min="0"
                :max="depthMaximum"
                step="1"
                thumb-label
                density="compact"
                hide-details
                :disabled="!!projectionReason"
                data-testid="oct-slab-range"
              >
                <template #label>
                  <span class="d-inline-flex align-center">
                    Slab
                    <ReasonedAction
                      tooltip="First and last voxel indices along the chosen axis, both included in the projection."
                      class="ml-1"
                    >
                      <v-btn
                        icon="mdi-information-outline"
                        size="x-small"
                        variant="text"
                        aria-label="About slab range"
                        data-testid="oct-slab-help"
                      />
                    </ReasonedAction>
                  </span>
                </template>
              </v-range-slider>
            </ReasonedAction>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <v-expansion-panel bg-color="transparent">
          <v-expansion-panel-title
            class="section-title"
            :min-height="36"
            data-testid="oct-thickness-toggle"
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
                data-testid="oct-thin-highlight"
                label="Highlight thin regions"
              />
            </ReasonedAction>
            <ReasonedAction :reason="segmentReason ?? undefined" block>
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
                :disabled="!!segmentReason"
                aria-label="Thickness segment"
                data-testid="oct-segmentation-segment"
              >
                <template #selection="{ item }">
                  <span class="d-inline-flex align-center overflow-hidden">
                    <ColorDot
                      v-if="item.raw.color"
                      :color="item.raw.color"
                      class="mr-2 flex-shrink-0"
                      aria-hidden="true"
                      data-testid="oct-segment-color"
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
                        data-testid="oct-segment-option-color"
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
                    aria-label="About occupied depth"
                    data-testid="oct-thickness-help"
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
                  data-testid="oct-thickness-threshold-input"
                />
              </ReasonedAction>
            </div>
            <ReasonedAction :reason="thresholdReason ?? undefined" block>
              <v-slider
                :model-value="
                  Math.min(settings.thresholdMicrons, thresholdMaximum)
                "
                @update:model-value="updateSliderThreshold"
                min="0"
                :max="thresholdMaximum"
                :step="0"
                density="compact"
                hide-details
                :disabled="!!thresholdReason"
                name="Thickness threshold in micrometers"
                data-testid="oct-thickness-threshold"
              />
            </ReasonedAction>
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
.en-face-controls.embedded {
  max-height: none;
  overflow: visible;
}
.en-face-controls.embedded .threshold-heading {
  flex-wrap: wrap;
}
.controls-title {
  font-size: 1rem;
  padding: 12px 16px;
}
.threshold-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
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
.section-title {
  padding: 0 4px;
  font-size: 0.8125rem;
}
.control-sections :deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 0 0;
}
.thickness-controls :deep(.v-expansion-panel-text__wrapper) {
  padding-top: 0;
}
.en-face-controls :deep(.v-switch .v-label) {
  font-size: 0.875rem;
}
.en-face-controls :deep(.v-field__input) {
  font-size: 0.875rem;
}
</style>
