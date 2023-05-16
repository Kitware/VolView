<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref } from 'vue';
import { useDicomWebStore } from '../../store/dicom-web/dicom-web-store';

export default defineComponent({
  setup() {
    const dicomWeb = useDicomWebStore();

    // If host changed while mounted, fetch metadata
    const hostAtStart = ref<typeof dicomWeb.host>();
    onMounted(() => {
      hostAtStart.value = dicomWeb.host;
    });
    onUnmounted(() => {
      // Re-fetch if address changed or an error message exists
      if (hostAtStart.value !== dicomWeb.host || dicomWeb.message)
        dicomWeb.fetchInitialDicoms();
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
      v-model="dicomWeb.host"
      class="server-param"
      label="Host Address"
      clearable
    />
  </div>
</template>
