<script lang="ts">
import { computed, defineComponent } from 'vue';

import PatientDetails from './PatientDetails.vue';
import { useDicomWebStore } from '../../store/dicom-web/dicom-web-store';

export default defineComponent({
  components: {
    PatientDetails,
  },
  setup() {
    const dicomWeb = useDicomWebStore();
    dicomWeb.fetchPatientsOnce();

    const patients = computed(() =>
      dicomWeb.patients
        .map((info) => ({
          key: info.PatientID,
          name: info.PatientName,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
    );

    return {
      patients,
      dicomWeb,
    };
  },
});
</script>

<template>
  <p v-if="dicomWeb.message.length > 0" class="error-message">
    {{ dicomWeb.message }}
  </p>

  <v-expansion-panels v-else-if="patients.length > 0" multiple accordion>
    <v-expansion-panel v-for="patient in patients" :key="patient.key">
      <v-expansion-panel-title>
        <div class="patient-header">
          <v-icon class="collection-header-icon">mdi-account</v-icon>
          <span class="patient-header-name" :title="patient.name">
            {{ patient.name }}
          </span>
        </div>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <patient-details :patient-key="patient.key" />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<style scoped>
.v-expansion-panel--active:not(:first-child):after {
  opacity: 100;
}

.v-expansion-panel--active + .v-expansion-panel::after {
  opacity: 100;
}

.error-message {
  margin-top: 1em;
  color: red;
}
</style>
