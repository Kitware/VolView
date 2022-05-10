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
    </v-container>
  </v-card>
</template>

<script>
import { computed, defineComponent } from '@vue/composition-api';
import { usePaintToolStore } from '../store/tools/paint';

export default defineComponent({
  name: 'PaintControls',

  setup() {
    const paintStore = usePaintToolStore();

    const brushSize = computed(() => paintStore.brushSize);

    const setBrushSize = (size) => {
      paintStore.setBrushSize(Number(size));
    };

    return {
      brushSize,
      setBrushSize,
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
