<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web.store';

export default defineComponent({
  components: {},
  setup() {
    const dicomWeb = useDicomWebStore();

    return {
      dicomWeb,
    };
  },
});
</script>

<template>
  <v-form v-on:submit.prevent="dicomWeb.fetchDicomList()" class="form">
    <v-text-field
      v-model="dicomWeb.host"
      id="host-input"
      class="server-param"
      label="DICOMWeb Host Address"
      clearable
    />
    <v-btn @click="dicomWeb.fetchDicomList()">List DICOMS</v-btn>
    <p v-if="dicomWeb.message.length > 0" class="error-message">
      {{ dicomWeb.message }}
    </p>
  </v-form>
</template>

<style scoped>
.error-message {
  margin-top: 1em;
  color: red;
}
</style>
