<template>
  <v-list>
    <template v-for="mm in listOfMeasurements">
      <v-list-item two-line :key="mm.id">
        <v-list-item-content>
          <template v-if="mm.type === 'ruler'">
            <v-list-item-title>Ruler</v-list-item-title>
            <v-list-item-subtitle>
              Length: {{ mm.data.length.toFixed(2) }}mm
            </v-list-item-subtitle>
          </template>
        </v-list-item-content>
        <v-list-item-action>
          <v-btn icon @click="removeMeasurement(mm.id)">
            <v-icon>mdi-delete</v-icon>
          </v-btn>
        </v-list-item-action>
      </v-list-item>
    </template>
  </v-list>
</template>

<script>
import { mapState } from 'vuex';

export default {
  name: 'MeasurementsModule',

  inject: ['widgetProvider'],

  computed: {
    ...mapState('measurements', ['measurementWidgets', 'measurements']),
    listOfMeasurements() {
      return this.measurementWidgets.map((id) => ({
        id,
        ...this.measurements[id],
      }));
    },
  },

  methods: {
    removeMeasurement(id) {
      this.widgetProvider.removeWidget(id);
    },
  },
};
</script>

<style></style>
