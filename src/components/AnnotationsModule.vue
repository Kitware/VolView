<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import MeasurementsList from './MeasurementsList.vue';
import LabelmapList from './LabelmapList.vue';

export default defineComponent({
  components: {
    MeasurementsList,
    LabelmapList,
  },
  setup() {},
});
</script>

<template>
  <v-container>
    <v-list dense>
      <v-subheader>Measurements</v-subheader>
      <measurements-list />
      <v-subheader>Labelmaps</v-subheader>
      <labelmap-list />
    </v-list>
  </v-container>
</template>

<style scoped></style>
