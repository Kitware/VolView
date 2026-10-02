<script setup lang="ts">
import { computed } from 'vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { OCT_COVERAGE_HELP, OCT_THICKNESS_HELP } from './thickness';
import type { ProjectionResult } from './types';
import type { OCTViewConfig } from './store';

const props = defineProps<{
  settings: OCTViewConfig;
  projection: ProjectionResult | null;
  stateMessage: string | null;
  depthStart: number;
  depthEnd: number;
  segmentName: string;
  highlightedPixels: number;
  highlightReason: string | null;
}>();
const methodLabel = computed(
  () => ({ mean: 'Mean', max: 'Maximum', sum: 'Sum' })[props.settings.method]
);
const coverage = computed(() => ({
  missingIntensity:
    props.projection?.validPixels?.reduce(
      (count, valid) => count + Number(!valid),
      0
    ) ?? 0,
  unmeasurableThickness:
    props.projection?.thicknessMicrons?.reduce(
      (count, thickness) => count + Number(Number.isNaN(thickness)),
      0
    ) ?? 0,
}));
</script>

<template>
  <div>
    <template v-if="projection"
      >{{ methodLabel }} • slab {{ depthStart }}–{{ depthEnd }}<br />{{
        projection.width
      }}
      × {{ projection.height }}</template
    >
    <template v-else>{{ stateMessage }}</template>
    <ReasonedAction
      v-if="coverage.missingIntensity || coverage.unmeasurableThickness"
      :tooltip="OCT_COVERAGE_HELP"
      class="pointer-events-all"
      data-testid="oct-coverage-summary"
      :data-missing-intensity-alines="coverage.missingIntensity"
      :data-unmeasurable-thickness-alines="coverage.unmeasurableThickness"
    >
      <span tabindex="0">
        <br />
        <template v-if="coverage.missingIntensity">
          A-lines without intensity: {{ coverage.missingIntensity }}
        </template>
        <template
          v-if="coverage.missingIntensity && coverage.unmeasurableThickness"
        >
          •
        </template>
        <template v-if="coverage.unmeasurableThickness">
          A-lines with thickness unavailable:
          {{ coverage.unmeasurableThickness }}
        </template>
      </span>
    </ReasonedAction>
    <ReasonedAction
      v-if="settings.highlightThin"
      :reason="highlightReason ?? undefined"
      :tooltip="OCT_THICKNESS_HELP"
      class="pointer-events-all"
    >
      <span :tabindex="highlightReason ? undefined : 0">
        • {{ segmentName }}:
        <template v-if="highlightReason">Highlight unavailable</template>
        <template v-else>{{ highlightedPixels }} thin pixels</template>
        (&lt; {{ settings.thresholdMicrons }} µm)
      </span>
    </ReasonedAction>
  </div>
</template>
