<template>
  <v-card width="350px">
    <v-container>
      <!--
      <v-row no-gutters align="center">
        <v-col>
          <v-select
            density="compact"
            outlined
            hide-details
            label="Select or create a labelmap"
          />
        </v-col>
      </v-row>
      -->
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
                variant="underlined"
                class="mt-n1 pt-0"
                style="width: 40px"
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
                variant="underlined"
                class="mt-n1 pt-0"
                style="width: 40px"
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
      <v-row no-gutters align="center">
        <v-col>
          <v-color-picker
            hide-canvas
            hide-inputs
            hide-mode-switch
            hide-sliders
            show-swatches
            elevation="0"
            :swatches="swatches"
            :model-value="brushColor"
            @update:model-value="setBrushColor"
          />
        </v-col>
      </v-row>
    </v-container>
  </v-card>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { LABELMAP_PALETTE } from '../config';
import { usePaintToolStore } from '../store/tools/paint';
import { rgbaToHexa } from '../utils/color';

const HEXA_LENGTH = 9;

// generates both the swatches for v-color-picker and the color-to-value mapping
function convertToSwatches(
  palette: typeof LABELMAP_PALETTE,
  width: number = 5
) {
  const hexToValue: Record<string, number> = {};
  const swatches: string[][] = [];
  const entries = Object.entries(palette);
  while (entries.length) {
    const [value, rgba] = entries.shift()!;
    const hex = rgbaToHexa(rgba).toUpperCase();
    hexToValue[hex] = Number(value);

    let row = swatches[swatches.length - 1];
    if (!row || row.length === width) {
      row = [];
      swatches.push(row);
    }
    row.push(hex);
  }

  return { hexToValue, swatches };
}

export default defineComponent({
  name: 'PaintControls',

  setup() {
    const paintStore = usePaintToolStore();

    const { hexToValue, swatches } = convertToSwatches(LABELMAP_PALETTE, 3);
    const brushColor = computed(() => {
      const value = paintStore.brushValue;
      if (value in LABELMAP_PALETTE) {
        return rgbaToHexa(LABELMAP_PALETTE[value]);
      }
      return null;
    });

    const setBrushColor = (color: string) => {
      // Passthrough if #RRGGBBAA, add alpha if #RRGGBB
      const withAlpha = color.length === HEXA_LENGTH ? color : `${color}FF`;
      const hexa = withAlpha.toUpperCase();
      const brushValue = hexToValue[hexa];
      if (brushValue == null) {
        throw new Error(`Brush value invalid`);
      }
      paintStore.setBrushValue(brushValue);
    };

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
      swatches,
      brushColor,
      setBrushColor,
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
