<script setup lang="ts">
import MeasurementsToolList from '@/src/components/MeasurementsToolList.vue';
import { useRulerStore } from '@/src/store/tools/rulers';

const toolStore = useRulerStore();
</script>

<template>
  <measurements-tool-list :toolStore="toolStore" icon="mdi-ruler">
    <template v-slot:details="{ tool }">
      <v-row>
        <v-col cols="3">Slice: {{ tool.slice + 1 }}</v-col>
        <v-col cols="3">Axis: {{ tool.axis }}</v-col>
        <v-col>
          Length:
          <span class="value">
            {{ toolStore.lengthByID[tool.id].toFixed(2) }}mm
          </span>
        </v-col>
      </v-row>
    </template>
  </measurements-tool-list>
</template>
