<script setup lang="ts">
import { ref, watch } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { rangeThumbLabels } from '@/src/utils/rangeThumbLabels';
import EnFaceThicknessControls from './EnFaceThicknessControls.vue';
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
const projectionMethods = [
  { title: 'Mean', value: 'mean' },
  { title: 'Maximum', value: 'max' },
  { title: 'Sum', value: 'sum' },
];
const vSlabLabels = rangeThumbLabels('Slab start', 'Slab end');
function updateSlab([depthStart, depthEnd]: number[]) {
  slabDraft.value = null;
  emit('patch', { depthStart, depthEnd });
}
function applyKeyboardSlab() {
  // Thumb key handlers update the draft before the event bubbles here.
  if (slabDraft.value) updateSlab(slabDraft.value);
}
function updateMethod(method: string) {
  if (method === 'mean' || method === 'max' || method === 'sum')
    emit('patch', { method });
}
function updateAxis(axis: number) {
  if (axis === 0 || axis === 1 || axis === 2)
    emit('patch', { axis, depthStart: 0, depthEnd: null });
}
</script>

<template>
  <v-card
    class="en-face-controls"
    :class="{ embedded }"
    :width="embedded ? '100%' : 300"
    :rounded="embedded ? 0 : 'lg'"
    :flat="embedded"
    data-testid="enface-rendering-panel"
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
            data-testid="enface-projection-toggle"
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
                data-testid="enface-projection-method"
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
                data-testid="enface-projection-axis"
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
                data-testid="enface-slab-range"
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
                        data-testid="enface-slab-help"
                      />
                    </ReasonedAction>
                  </span>
                </template>
              </v-range-slider>
            </ReasonedAction>
          </v-expansion-panel-text>
        </v-expansion-panel>
        <EnFaceThicknessControls
          v-bind="thickness"
          :settings="settings"
          :embedded="embedded"
          @patch="emit('patch', $event)"
        />
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
.controls-title {
  font-size: 1rem;
  padding: 12px 16px;
}
.section-title {
  padding: 0 4px;
  font-size: 0.8125rem;
}
.control-sections :deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 0 0;
}
.en-face-controls :deep(.v-field__input) {
  font-size: 0.875rem;
}
</style>
