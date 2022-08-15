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
          <v-btn icon @click="remove(mm.type, mm.id)">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
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
import { useRulerStore } from '../store/tools/rulers';

interface Measurement {
  id: string;
  type: 'ruler';
  data: any;
}

export default defineComponent({
  name: 'MeasurementsList',
  setup() {
    const rulerStore = useRulerStore();

    const measurements = computed(() => {
      const mms = [
        ...rulerStore.rulerIDs.map((id) => {
          const ruler = rulerStore.rulers[id];
          return {
            id,
            type: 'ruler',
            data: {
              length: rulerStore.lengthByID[id],
              color: ruler.color,
            },
          } as Measurement;
        }),
      ];
      return mms;
    });

    function remove(type: Measurement['type'], id: string) {
      if (type === 'ruler') {
        rulerStore.removeRuler(id);
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
      updateColor,
    };
  },
});
</script>
