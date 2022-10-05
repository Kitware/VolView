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
  <div class="overflow-y-auto mx-2 fill-height">
    <v-list dense>
      <v-subheader class="annot-subheader">Measurements</v-subheader>
      <measurements-list />
      <v-subheader class="annot-subheader">Labelmaps</v-subheader>
      <labelmap-list />
    </v-list>
  </div>
</template>

<style scoped>
.annot-subheader {
  margin: 8px 0;
}
.theme--dark.annot-subheader {
  background: rgba(255, 255, 255, 0.08);
}

.theme--light.annot-subheader {
  background: rgba(0, 0, 0, 0.08);
}
</style>
