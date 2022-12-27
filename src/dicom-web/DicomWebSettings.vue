<script lang="ts">
import {
  defineComponent,
  onMounted,
  onUnmounted,
  ref,
} from '@vue/composition-api';
import { useDicomWebStore } from './dicom-web.store';
import DicomWebHost from './DicomWebHost.vue';

export default defineComponent({
  setup() {
    const dicomWeb = useDicomWebStore();

    // If host changed fetch metadata
    const hostAtStart = ref<string | undefined>('');
    onMounted(() => {
      hostAtStart.value = dicomWeb.host;
    });
    onUnmounted(() => {
      if (hostAtStart.value !== dicomWeb.host) dicomWeb.fetchDicomList();
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
