<template>
  <v-list v-if="listOfMeasurements.length">
    <template v-for="mm in listOfMeasurements">
      <v-list-item two-line :key="mm.id">
        <v-list-item-content>
          <template v-if="mm.type === 'ruler'">
            <v-list-item-title>Ruler: {{ mm.data.name }}</v-list-item-title>
            <v-list-item-subtitle>
              Length: {{ mm.data.length.toFixed(2) }}mm
            </v-list-item-subtitle>
          </template>
        </v-list-item-content>
        <v-list-item-action>
          <v-btn icon @click="remove(mm.id)">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </v-list-item-action>
      </v-list-item>
    </template>
  </v-list>
  <div v-else>No measurements yet</div>
</template>

<script>
import { computed, defineComponent } from '@vue/composition-api';
import { useStore, useComputedState } from '@/src/composables/store';
import { useWidgetProvider } from '@/src/composables/widgetProvider';

export default defineComponent({
  name: 'MeasurementsModule',
  setup() {
    const store = useStore();
    const widgetProvider = useWidgetProvider();

    const { baseImage, measurements, parents } = useComputedState({
      baseImage: (state) => state.selectedBaseImage,
      measurements: (state) => state.measurements.measurements,
      parents: (state) => state.measurements.parents,
    });

    const listOfMeasurements = computed(() => {
      const widgets = parents.value[baseImage.value] ?? [];
      return widgets.map((id) => ({
        id,
        ...measurements.value[id],
      }));
    });

    return {
      listOfMeasurements,
      async remove(id) {
        widgetProvider.deleteWidget(id);
        store.dispatch('measurements/removeById', id);
      },
    };
  },
});
</script>
