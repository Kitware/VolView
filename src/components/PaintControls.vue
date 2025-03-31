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
                Will only fill between segmented slices where none of their
                direct neighbors are segmented.
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
    const fillStep = computed(() => fillBetweenStore.fillStep);

    const startCompute = () => {
      const id = paintStore.activeSegmentGroupID;
      if (!id) return;
      fillBetweenStore.computeFillBetween(id);
    };

    return {
      brushSize,
      setBrushSize,
      mode,
      PaintMode,
      fillStep,
      startCompute,
      confirmFill: fillBetweenStore.confirmFill,
      cancelFill: fillBetweenStore.cancelFill,
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
