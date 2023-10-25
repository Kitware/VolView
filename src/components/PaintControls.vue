<template>
  <v-container>
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
    <v-row no-gutters align="center">
      <v-col>
        <v-slider
          :model-value="opacity"
          @update:model-value="setOpacity"
          density="compact"
          hide-details
          label="Opacity"
          min="0"
          max="1"
          step="0.01"
        >
          <template v-slot:append>
            <v-text-field
              :model-value="opacity"
              @input="setOpacity"
              variant="plain"
              class="mt-n3 pt-0 pl-2"
              style="width: 60px"
              density="compact"
              hide-details
              type="number"
              min="0"
              max="1"
              step="0.1"
            />
          </template>
        </v-slider>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { usePaintToolStore } from '../store/tools/paint';

export default defineComponent({
  name: 'PaintControls',

  setup() {
    const paintStore = usePaintToolStore();

    const brushSize = computed(() => paintStore.brushSize);
    const setBrushSize = (size: number) => {
      paintStore.setBrushSize(Number(size));
    };

    const opacity = computed(() => paintStore.labelmapOpacity);
    const setOpacity = (op: number) => {
      paintStore.setLabelmapOpacity(Number(op));
    };

    return {
      brushSize,
      setBrushSize,
      opacity,
      setOpacity,
    };
  },
});
</script>

<style scoped>
.form-label {
  color: rgba(0, 0, 0, 0.6);
}

.scrolled-radios {
  max-height: 300px;
  overflow: auto;
  /* prevents hover circle from clipping left */
  padding-left: 6px;
}
</style>
