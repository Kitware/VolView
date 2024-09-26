<template>
  <v-container>
    <v-row no-gutters align="center" class="mb-4 ml-1">
      <v-item-group v-model="mode" mandatory selected-class="selected">
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
      </v-item-group>
    </v-row>
    <v-row no-gutters align="center">
      <v-col>
        <v-slider
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
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintToolStore } from '../store/tools/paint';

export default defineComponent({
  name: 'PaintControls',

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

    return {
      brushSize,
      setBrushSize,
      mode,
      PaintMode,
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
  min-width: 56px;
  height: 56px;
  width: 56px;
}

.mode-button:not(:last-child) {
  margin-right: 6px;
}
</style>
