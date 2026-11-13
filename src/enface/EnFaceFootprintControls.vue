<script setup lang="ts">
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import ColorDot from '@/src/components/ColorDot.vue';
import type { EnFaceViewConfig, ThicknessControlState } from './store';

const props = defineProps<
  Pick<ThicknessControlState, 'segments' | 'segmentationReason'> & {
    settings: EnFaceViewConfig;
  }
>();
const emit = defineEmits<{ patch: [settings: Partial<EnFaceViewConfig>] }>();
function updateEnabled(enabled: boolean | null) {
  const ids = props.settings.footprintSegmentIds;
  emit('patch', {
    showFootprints: !!enabled,
    footprintSegmentIds: ids.length
      ? ids
      : props.segments.slice(0, 1).map((segment) => segment.value),
  });
}
const scopes = [
  { title: 'Current slab', value: 'slab' },
  { title: 'Entire volume', value: 'volume' },
];
</script>

<template>
  <v-expansion-panel bg-color="transparent">
    <v-expansion-panel-title
      class="section-title"
      :min-height="36"
      data-testid="enface-footprints-section-toggle"
      >Segmentation projection</v-expansion-panel-title
    >
    <v-expansion-panel-text>
      <ReasonedAction :reason="segmentationReason ?? undefined" block>
        <v-switch
          :model-value="settings.showFootprints"
          @update:model-value="updateEnabled"
          color="secondary"
          density="compact"
          hide-details
          :disabled="!!segmentationReason"
          label="Show segment footprints"
          aria-label="Show segment footprints"
          data-testid="enface-footprints-toggle"
        />
      </ReasonedAction>
      <ReasonedAction :reason="segmentationReason ?? undefined" block>
        <v-select
          :model-value="settings.footprintSegmentIds"
          @update:model-value="emit('patch', { footprintSegmentIds: $event })"
          :items="segments"
          label="Projected segments"
          aria-label="Projected segments"
          data-testid="enface-footprint-segments"
          density="compact"
          variant="outlined"
          multiple
          chips
          closable-chips
          hide-details
          class="mb-3"
          :disabled="!!segmentationReason"
        >
          <template #item="{ props: itemProps, item }"
            ><v-list-item v-bind="itemProps"
              ><template #prepend
                ><ColorDot
                  v-if="item.raw.color"
                  :color="item.raw.color"
                  class="mr-2"
                  aria-hidden="true" /></template></v-list-item
          ></template>
        </v-select>
      </ReasonedAction>
      <ReasonedAction
        :reason="segmentationReason ?? undefined"
        tooltip="Shows a segment wherever its voxels intersect the selected depth range. Segments at different depths can overlap in projection."
        block
      >
        <v-select
          :model-value="settings.footprintScope"
          @update:model-value="emit('patch', { footprintScope: $event })"
          :items="scopes"
          label="Footprint depth"
          aria-label="Footprint depth"
          data-testid="enface-footprint-scope"
          density="compact"
          variant="outlined"
          hide-details
          :disabled="!!segmentationReason"
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
:deep(.v-switch .v-label) {
  font-size: 0.875rem;
}
</style>
