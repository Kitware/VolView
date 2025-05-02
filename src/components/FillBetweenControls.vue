<template>
  <div class="mb-2 d-flex align-center">
    <mini-expansion-panel>
      <template #title> Interpolate segmentation between slices. </template>
      <ul>
        <li>
          Will only fill between segmented slices where none of their direct
          neighbors are segmented.
        </li>
        <li>Only the selected segment will be filled between.</li>
        <li>
          Uses
          <a
            href="https://insight-journal.org/browse/publication/977"
            target="_blank"
          >
            morphological contour interpolation
          </a>
          method.
        </li>
      </ul>
    </mini-expansion-panel>
  </div>
  <v-row justify="space-between" no-gutters>
    <v-btn
      variant="tonal"
      :prepend-icon="fillStep === 'computing' ? '' : 'mdi-cogs'"
      @click="startCompute"
      :disabled="fillStep !== 'start'"
      :loading="fillStep === 'computing'"
    >
      Preview
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-check"
      :disabled="fillStep !== 'previewing'"
      @click="confirmFill"
    >
      Confirm
    </v-btn>
    <v-btn
      variant="tonal"
      prepend-icon="mdi-cancel"
      :disabled="fillStep !== 'previewing'"
      @click="cancelFill"
    >
      Cancel
    </v-btn>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MiniExpansionPanel from './MiniExpansionPanel.vue';
import { useFillBetweenStore } from '../store/tools/fillBetween';
import { usePaintToolStore } from '../store/tools/paint';

const fillBetweenStore = useFillBetweenStore();
const paintStore = usePaintToolStore();

const fillStep = computed(() => fillBetweenStore.fillStep);

function startCompute() {
  const id = paintStore.activeSegmentGroupID;
  if (!id) return;
  fillBetweenStore.computeFillBetween(id);
}

const confirmFill = () => fillBetweenStore.confirmFill();
const cancelFill = () => fillBetweenStore.cancelFill();
</script>
