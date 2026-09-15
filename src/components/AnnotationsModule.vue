<script setup lang="ts">
import { ref } from 'vue';
import SegmentList from '@/src/segmentation/components/SegmentList.vue';
import ToolControls from './ToolControls.vue';
import MeasurementsToolList from './MeasurementsToolList.vue';

const openSections = ref(['measurements']);
</script>

<template>
  <div>
    <segment-list />
    <tool-controls />
    <v-expansion-panels
      v-model="openSections"
      multiple
      variant="accordion"
      class="annotation-panels annotation-section"
    >
      <v-expansion-panel value="measurements">
        <v-expansion-panel-title data-testid="measurements-section">
          <v-icon class="annotation-panel-icon">mdi-ruler</v-icon>
          Measurements
        </v-expansion-panel-title>
        <v-expansion-panel-text class="section-body">
          <measurements-tool-list />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<style scoped src="./styles/annotations.css"></style>
<style src="./styles/annotation-panels.css"></style>
