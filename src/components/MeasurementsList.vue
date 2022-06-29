<template>
  <v-list dense v-if="measurements.length">
    <v-list-item v-for="mm in measurements" :key="mm.id" two-line>
      <v-list-item-content>
        <template v-if="mm.type === 'ruler'">
          <v-list-item-title>Ruler (ID = {{ mm.id }})</v-list-item-title>
          <v-list-item-subtitle>
            Length: {{ mm.data.length.toFixed(2) }}mm
          </v-list-item-subtitle>
        </template>
      </v-list-item-content>
      <v-list-item-action>
        <v-btn icon @click="remove(mm.type, mm.id)">
          <v-icon>mdi-delete</v-icon>
        </v-btn>
      </v-list-item-action>
    </v-list-item>
  </v-list>
  <div v-else class="caption empty-state">No measurements yet</div>
</template>

<style scoped>
.empty-state {
  text-align: center;
}
</style>

<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { useRulerToolStore } from '../store/tools/rulers';

interface Measurement {
  id: string;
  type: 'ruler';
  data: any;
}

export default defineComponent({
  name: 'MeasurementsList',
  setup() {
    const rulerStore = useRulerToolStore();

    const measurements = computed(() => {
      const mms = [
        ...rulerStore.rulerIDs.map(
          (id) =>
            ({
              id,
              type: 'ruler',
              data: {
                length: rulerStore.lengths[id],
              },
            } as Measurement)
        ),
      ];
      return mms;
    });

    function remove(type: Measurement['type'], id: string) {
      if (type === 'ruler') {
        rulerStore.removeRuler(id);
      }
    }

    return {
      measurements,
      remove,
    };
  },
});
</script>
