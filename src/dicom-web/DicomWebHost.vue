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
  <v-text-field
    v-model="dicomWeb.host"
    id="host-input"
    class="server-param"
    label="DICOMWeb Host Address"
    clearable
  />
</template>
