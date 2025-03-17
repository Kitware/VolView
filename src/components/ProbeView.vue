<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useProbeStore } from '@/src/store/probe';
import { shortenNumber } from '@/src/utils';

const probeStore = useProbeStore();
const { probeData } = storeToRefs(probeStore);

const formattedProbeItems = computed(() => {
  if (!probeData.value) return [];
  const sampleItems = probeData.value.samples.map((sample) => ({
    label: sample.name,
    value: sample.displayValues
      .map((item) => (typeof item === 'number' ? shortenNumber(item) : item))
      .join(', '),
  }));

  // Add additional item for Position
  const positionItem = {
    label: 'Position',
    value: Array.from(probeData.value.pos).map(Math.round).join(', '),
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
        style="max-width: 100%"
      >
        <span
          class="text-left text-truncate mr-2 flex-grow-0 flex-shrink-1"
          style="min-width: 6rem; max-width: 50%"
        >
          {{ item.label }}
        </span>
        <span
          class="text-right font-weight-bold text-truncate flex-grow-1 flex-shrink-1"
        >
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
