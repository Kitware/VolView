<script lang="ts">
import { defineComponent } from 'vue';
import MeasurementsRulerList from './MeasurementsRulerList.vue';
import LabelmapList from './LabelmapList.vue';

export default defineComponent({
  components: {
    MeasurementsRulerList,
    LabelmapList,
  },
  setup() {},
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <v-list density="compact">
      <v-list-subheader class="annot-subheader">Measurements</v-list-subheader>
      <measurements-ruler-list />
      <v-list-subheader class="annot-subheader">Labelmaps</v-list-subheader>
      <labelmap-list />
    </v-list>
  </div>
</template>

<style scoped>
.annot-subheader {
  margin: 8px 0;
}
.v-theme--dark.annot-subheader {
  background: rgba(255, 255, 255, 0.08);
}

.v-theme--light.annot-subheader {
  background: rgba(0, 0, 0, 0.08);
}
</style>
