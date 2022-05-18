<template>
  <v-card width="350px">
    <v-container>
      <!--
      <v-row no-gutters align="center">
        <v-col>
          <v-select
            dense
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
            :value="brushSize"
            @input="setBrushSize"
            dense
            hide-details
            label="Radius"
            min="1"
            max="50"
          >
            <template v-slot:append>
              <v-text-field
                :value="brushSize"
                @input="setBrushSize"
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
          <v-color-picker
            hide-canvas
            hide-inputs
            hide-mode-switch
            hide-sliders
            show-swatches
            :swatches="swatches"
            :value="brushColor"
            @input="setBrushColor"
          />
        </v-col>
      </v-row>
    </v-container>
  </v-card>
</template>

<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { LABELMAP_PALETTE } from '../constants';
import { usePaintToolStore } from '../store/tools/paint';
import { rgbaToHexa } from '../utils/color';

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
    const brushSize = computed(() => paintStore.brushSize);

    const { hexToValue, swatches } = convertToSwatches(LABELMAP_PALETTE, 3);
    const brushColor = computed(() => {
      const value = paintStore.brushValue;
      if (value in LABELMAP_PALETTE) {
        return rgbaToHexa(LABELMAP_PALETTE[value]);
      }
      return null;
    });

    const setBrushSize = (size: number) => {
      paintStore.setBrushSize(Number(size));
    };

    const setBrushColor = (color: string) => {
      const hexa = color.toUpperCase();
      if (hexa in hexToValue) {
        paintStore.setBrushValue(hexToValue[hexa]);
      }
    };

    return {
      brushSize,
      setBrushSize,
      swatches,
      brushColor,
      setBrushColor,
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
