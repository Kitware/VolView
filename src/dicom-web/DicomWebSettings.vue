<script lang="ts">
import {
  defineComponent,
  onMounted,
  onUnmounted,
  ref,
} from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web-store';
import DicomWebHost from './DicomWebHost.vue';

export default defineComponent({
  setup() {
    const dicomWeb = useDicomWebStore();

    // If host changed while mounted, fetch metadata
    const hostAtStart = ref<typeof dicomWeb.host>();
    onMounted(() => {
      hostAtStart.value = dicomWeb.host;
    });
    onUnmounted(() => {
      // re-fetch if address changed or an error message exists
      if (hostAtStart.value !== dicomWeb.host || dicomWeb.message)
        dicomWeb.fetchPatients();
    });

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
  <dicom-web-host />
</template>
