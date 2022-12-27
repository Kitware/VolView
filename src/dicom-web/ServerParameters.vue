<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web.store';
import DicomWebHost from './DicomWebHost.vue';

export default defineComponent({
  setup() {
    const dicomWeb = useDicomWebStore();

    return {
      dicomWeb,
    };
  },
  components: {
    DicomWebHost,
  },
});
</script>

<template>
  <v-form v-on:submit.prevent="dicomWeb.fetchDicomList()" class="form">
    <dicom-web-host />
    <v-btn @click="dicomWeb.fetchDicomList()">List DICOMS</v-btn>
  </v-form>
</template>

<style scoped>
.error-message {
  margin-top: 1em;
  color: red;
}
</style>
