<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import PatientList from './PatientList.vue';
import { useDicomWebStore } from './dicom-web.store';

export default defineComponent({
  components: {
    PatientList,
  },

  setup() {
    const dicomWeb = useDicomWebStore();
    return { dicomWeb };
  },
});
</script>

<template>
  <patient-list />
</template>
