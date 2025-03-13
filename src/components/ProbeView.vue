<script setup lang="ts">
import { computed } from 'vue';
import { useProbeStore } from '@/src/store/probe';
import { storeToRefs } from 'pinia';

const probeStore = useProbeStore();
const { probeData } = storeToRefs(probeStore);

const formattedProbeItems = computed(() => {
  if (!probeData.value) return [];
  const sampleItems = probeData.value.samples.map((sample) => ({
    label: sample.name,
    value: sample.displayValue.join(', '),
  }));

  // Add additional item for Position
  const positionItem = {
    label: 'Position',
    value: probeData.value.pos.map(Math.round).join(', '),
  };

  return [...sampleItems, positionItem];
});
</script>

<template>
  <v-card v-if="probeData" class="probe-value-display">
    <v-card-text>
      <div
        v-for="(item, index) in formattedProbeItems"
        :key="index"
        class="d-flex"
      >
        <span class="text-left text-truncate mr-2">
          {{ item.label }}
        </span>
        <span class="text-right ml-auto font-weight-bold">
          {{ item.value }}
        </span>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.probe-value-display {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 100%;
  pointer-events: none;
  z-index: 1000;
  text-align: right;
}
</style>
