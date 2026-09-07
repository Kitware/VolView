<script setup lang="ts">
import { ref } from 'vue';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useSegmentStore } from '@/src/store/segments';
import MeasurementsToolList from './MeasurementsToolList.vue';
import SegmentList from './SegmentList.vue';
import ToolControls from './ToolControls.vue';
import MeasurementRulerDetails from './MeasurementRulerDetails.vue';

const MeasurementTools = [
  {
    type: AnnotationToolType.Ruler,
    icon: 'mdi-ruler',
    details: MeasurementRulerDetails,
  },
  {
    type: AnnotationToolType.Rectangle,
    icon: 'mdi-vector-square',
  },
  {
    type: AnnotationToolType.Polygon,
    icon: 'mdi-pentagon-outline',
  },
];

// Paint, rectangle and polygon draw into the shared registry; rulers name
// their measurements out of their own.
const { segments } = useSegmentStore();
const { segments: rulerSegments } = useRulerStore();

// Rulers start collapsed: the list below them is the one a measurement shows
// up in, and naming one is the rarer gesture.
const rulerSection = ref<string[]>([]);
const measurementSection = ref(['measurements']);
</script>

<template>
  <div>
    <segment-list :registry="segments" noun="segment" masked />

    <v-expansion-panels
      v-model="rulerSection"
      multiple
      variant="accordion"
      class="annotation-section"
    >
      <v-expansion-panel value="rulers">
        <v-expansion-panel-title data-testid="rulers-section">
          Rulers
        </v-expansion-panel-title>
        <v-expansion-panel-text class="section-body">
          <segment-list :registry="rulerSegments" noun="ruler" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <tool-controls />

    <v-expansion-panels
      v-model="measurementSection"
      multiple
      variant="accordion"
      class="annotation-section"
    >
      <v-expansion-panel value="measurements">
        <v-expansion-panel-title data-testid="measurements-section">
          Measurements
        </v-expansion-panel-title>
        <v-expansion-panel-text class="section-body">
          <measurements-tool-list :tools="MeasurementTools" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<style scoped>
.annotation-section {
  width: 100%;
}

.section-body :deep(.v-expansion-panel-text__wrapper) {
  padding: 4px 0 12px;
}
</style>

<style scoped src="./styles/annotations.css"></style>
