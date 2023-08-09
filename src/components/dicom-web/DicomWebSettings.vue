<script lang="ts">
import { defineComponent, onUnmounted } from 'vue';
import { useDicomWebStore } from '../../store/dicom-web/dicom-web-store';

export default defineComponent({
  setup() {
    const dicomWeb = useDicomWebStore();

    onUnmounted(() => {
      dicomWeb.fetchDicomsOnce();
    });

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
      v-model="dicomWeb.savedHost"
      class="server-param"
      label="Host Address"
      clearable
    />
  </div>
</template>
