<template>
  <v-list dense v-if="measurements.length">
    <v-list-item v-for="mm in measurements" :key="mm.id" two-line>
      <template v-if="mm.type === 'ruler'">
        <v-menu offset-x :close-on-content-click="false">
          <template v-slot:activator="{ on, attrs }">
            <div
              class="color-dot clickable mr-3"
              :style="{ backgroundColor: mm.data.color }"
              v-on="on"
              v-bind="attrs"
            />
          </template>
          <v-color-picker
            :value="mm.data.color"
            @input="updateColor(mm.type, mm.id, $event)"
            hide-inputs
          />
        </v-menu>
        <v-list-item-content>
          <v-list-item-title>Ruler (ID = {{ mm.id }})</v-list-item-title>
          <v-list-item-subtitle>
            Length: {{ mm.data.length.toFixed(2) }}mm
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-action>
          <v-row no-gutters>
            <v-tooltip top>
              Reveal slice
              <template v-slot:activator="{ on }">
                <v-btn
                  class="mr-2"
                  icon
                  @click="jumpTo(mm.type, mm.id)"
                  v-on="on"
                >
                  <v-icon>mdi-target</v-icon>
                </v-btn>
              </template>
            </v-tooltip>
            <v-tooltip top>
              Delete
              <template v-slot:activator="{ on }">
                <v-btn icon @click="remove(mm.type, mm.id)" v-on="on">
                  <v-icon>mdi-delete</v-icon>
                </v-btn>
              </template>
            </v-tooltip>
          </v-row>
        </v-list-item-action>
      </template>
    </v-list-item>
  </v-list>
  <div v-else class="caption empty-state">No measurements yet</div>
</template>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
.empty-state {
  text-align: center;
}

.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
}
</style>

<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useRulerStore } from '../store/tools/rulers';

interface Measurement {
  id: string;
  type: 'ruler';
  imageID: string | null;
  data: any;
}

export default defineComponent({
  name: 'MeasurementsList',
  setup() {
    const rulerStore = useRulerStore();
    const { currentImageID } = useCurrentImage();

    const measurements = computed(() => {
      const imageID = currentImageID.value;
      return rulerStore.rulerIDs
        .map((id) => rulerStore.rulerByID[id])
        .filter((ruler) => ruler.imageID === imageID && !ruler.placing)
        .map((ruler) => {
          return {
            id: ruler.id,
            type: 'ruler',
            imageID: ruler.imageID,
            data: {
              length: rulerStore.lengthByID[ruler.id],
              color: ruler.color,
            },
          } as Measurement;
        });
    });

    function remove(type: Measurement['type'], id: string) {
      if (type === 'ruler') {
        rulerStore.removeRuler(id);
      }
    }

    function jumpTo(type: Measurement['type'], id: string) {
      if (type === 'ruler') {
        rulerStore.jumpToRuler(id);
      }
    }

    function updateColor(type: Measurement['type'], id: string, color: string) {
      if (type === 'ruler') {
        rulerStore.updateRuler(id, { color });
      }
    }

    return {
      measurements,
      remove,
      jumpTo,
      updateColor,
    };
  },
});
</script>
