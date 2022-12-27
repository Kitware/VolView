<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import ServerParameters from './ServerParameters.vue';
import PatientList from './PatientList.vue';
import { useDicomWebStore } from './dicom-web.store';

export default defineComponent({
  components: {
    ServerParameters,
    PatientList,
  },

  setup() {
    const dicomWeb = useDicomWebStore();
    return { dicomWeb };
  },
});
</script>

<template>
  <div><server-parameters v-if="dicomWeb.message" /> <patient-list /></div>
</template>

<style scoped></style>
