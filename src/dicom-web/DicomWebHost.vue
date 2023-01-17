<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web-store';

export default defineComponent({
  setup() {
    const dicomWeb = useDicomWebStore();

    return {
      dicomWeb,
    };
  },
});
</script>

<template>
  <div>
    <h3 class="mb-4">DICOMWeb</h3>
    <v-text-field
      v-model="dicomWeb.hostName"
      class="server-param"
      label="Host Display Name"
      clearable
    />
    <v-text-field
      v-model="dicomWeb.host"
      class="server-param"
      label="Host Address"
      clearable
    />
  </div>
</template>
