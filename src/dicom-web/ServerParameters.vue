<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web.store';

const URL_CONFIGURED = Boolean(process.env.VUE_APP_DICOM_WEB_URL);

export default defineComponent({
  components: {},
  setup() {
    const dicomWeb = useDicomWebStore();
    if (URL_CONFIGURED) dicomWeb.fetchDicomList();

    return {
      dicomWeb,
      showForm: !URL_CONFIGURED,
    };
  },
});
</script>

<template>
  <v-form v-on:submit.prevent="dicomWeb.fetchDicomList()" class="form">
    <v-text-field
      v-if="showForm"
      v-model="dicomWeb.host"
      id="host-input"
      class="server-param"
      label="DICOMWeb Host Address"
      clearable
    />
    <v-btn v-if="showForm" @click="dicomWeb.fetchDicomList()"
      >List DICOMS</v-btn
    >
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
