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

  const { pos, index, spacing } = probeData.value;
  // Enough decimals to tell neighboring voxels apart along the finest axis.
  const decimals = Math.max(0, Math.ceil(-Math.log10(Math.min(...spacing))));
  const positionItem = {
    label: 'Position',
    value: Array.from(pos)
      .map((coord) => coord.toFixed(decimals))
      .join(', '),
  };
  const indexItem = { label: 'Voxel', value: index.join(', ') };

  return [...sampleItems, positionItem, indexItem];
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
