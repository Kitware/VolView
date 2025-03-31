<template>
  <v-container>
    <v-row no-gutters align="center" class="mb-4 ml-1">
      <v-item-group
        v-model="mode"
        mandatory
        selected-class="selected"
        class="d-flex align-center justify-space-between w-100"
      >
        <v-item
          :value="PaintMode.CirclePaint"
          v-slot="{ selectedClass, toggle }"
        >
          <v-btn
            variant="tonal"
            rounded="8"
            stacked
            :class="['mode-button', selectedClass]"
            @click.stop="toggle"
          >
            <v-icon>mdi-brush</v-icon>
            <span class="text-caption">Paint</span>
          </v-btn>
        </v-item>
        <v-item :value="PaintMode.Erase" v-slot="{ selectedClass, toggle }">
          <v-btn
            variant="tonal"
            rounded="8"
            stacked
            :class="['mode-button', selectedClass]"
            @click.stop="toggle"
          >
            <v-icon>mdi-eraser</v-icon>
            <span class="text-caption">Eraser</span>
          </v-btn>
        </v-item>
        <v-item
          :value="PaintMode.FillBetween"
          v-slot="{ selectedClass, toggle }"
        >
          <v-btn
            variant="tonal"
            rounded="8"
            stacked
            :class="['mode-button', selectedClass]"
            @click.stop="toggle"
          >
            <v-icon>mdi-layers-triple</v-icon>
            <span class="text-caption">Fill Between</span>
          </v-btn>
        </v-item>
      </v-item-group>
    </v-row>
    <v-row no-gutters align="center">
      <v-slider
        v-if="mode === PaintMode.CirclePaint || mode === PaintMode.Erase"
        :model-value="brushSize"
        @update:model-value="setBrushSize"
        density="compact"
        hide-details
        label="Size"
        min="1"
        max="50"
      >
        <template v-slot:append>
          <v-text-field
            :model-value="brushSize"
            @input="setBrushSize"
            variant="plain"
            class="mt-n3 pt-0 pl-2"
            style="width: 60px"
            density="compact"
            hide-details
            type="number"
            min="1"
            max="50"
          />
        </template>
      </v-slider>

      <v-col v-if="mode === PaintMode.FillBetween">
        <div class="mb-2 d-flex align-center">
          <mini-expansion-panel>
            <template #title>
              Interpolate segmentation between slices.
            </template>
            <ul>
              <li>
                Segmentation will only expanded if a slice is segmented but none
                of the direct neighbors are segmented.
              </li>
              <li>
                All visible segments will be interpolated, not just the selected
                segment.
              </li>
              <li>
                The complete segmentation will be created by interpolating
                segmentations in empty slices.
              </li>
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
            :prepend-icon="fillMode === 'computing' ? '' : 'mdi-cogs'"
            @click="startCompute"
            :disabled="fillMode !== 'start'"
            :loading="fillMode === 'computing'"
          >
            Preview
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-check"
            :disabled="fillMode !== 'previewing'"
            @click="confirmFill"
          >
            Confirm
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-cancel"
            :disabled="fillMode !== 'previewing'"
            @click="cancelFill"
          >
            Cancel
          </v-btn>
        </v-row>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintToolStore } from '../store/tools/paint';
import { useFillBetweenStore } from '../store/tools/fillBetween';
import MiniExpansionPanel from './MiniExpansionPanel.vue';

export default defineComponent({
  name: 'PaintControls',

  components: {
    MiniExpansionPanel,
  },

  setup() {
    const paintStore = usePaintToolStore();
    const { brushSize, activeMode } = storeToRefs(paintStore);

    const setBrushSize = (size: number) => {
      paintStore.setBrushSize(Number(size));
    };

    const mode = computed({
      get: () => activeMode.value,
      set: (m) => {
        paintStore.setMode(m);
      },
    });

    const fillBetweenStore = useFillBetweenStore();
    const { mode: fillMode } = storeToRefs(fillBetweenStore);

    const startCompute = () => {
      fillBetweenStore.computeFillBetween();
    };

    const confirmFill = () => {
      fillBetweenStore.confirmFill();
    };

    const cancelFill = () => {
      fillBetweenStore.cancelFill();
    };

    return {
      brushSize,
      setBrushSize,
      mode,
      PaintMode,
      fillMode,
      startCompute,
      confirmFill,
      cancelFill,
    };
  },
});
</script>

<style scoped>
.selected {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.mode-button {
  min-height: 56px;
  min-width: 110px;
  height: 56px;
  width: 110px;
}
</style>
