<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import ServerParameters from './ServerParameters.vue';
import DicomWebInfos from './DicomWebInfos.vue';

export default defineComponent({
  components: {
    ServerParameters,
    DicomWebInfos,
  },
});
</script>

<template>
  <div><server-parameters /> <dicom-web-infos /></div>
</template>

<style scoped></style>
