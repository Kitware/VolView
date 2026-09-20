<script setup lang="ts">
import { ref } from 'vue';
import SegmentList from '@/src/segmentation/components/SegmentList.vue';
import PaintControls from '@/src/segmentation/components/PaintControls.vue';
import MeasurementsToolList from './MeasurementsToolList.vue';

const openSections = ref(['measurements']);
</script>

<template>
  <div>
    <segment-list />
    <paint-controls />
    <v-expansion-panels
      v-model="openSections"
      multiple
      variant="accordion"
      class="annotation-panels"
    >
      <v-expansion-panel value="measurements">
        <v-expansion-panel-title data-testid="measurements-section">
          <v-icon class="annotation-panel-icon">mdi-ruler</v-icon>
          Measurements
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <measurements-tool-list />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<style src="./styles/annotation-panels.css"></style>
