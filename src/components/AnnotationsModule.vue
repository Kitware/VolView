<script setup lang="ts">
import { ref } from 'vue';
import SegmentList from './SegmentList.vue';
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
      class="annotation-section"
    >
      <v-expansion-panel value="measurements">
        <v-expansion-panel-title data-testid="measurements-section">
          Measurements
        </v-expansion-panel-title>
        <v-expansion-panel-text class="section-body">
          <measurements-tool-list />
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
