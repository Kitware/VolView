<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web.store';

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
    <v-text-field
      v-model="dicomWeb.host"
      class="server-param"
      label="DICOMWeb Host Address"
      clearable
    />
    <v-text-field
      v-model="dicomWeb.hostName"
      class="server-param"
      label="DICOMWeb Host Display Name"
      clearable
    />
  </div>
</template>
