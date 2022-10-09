<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import ServerParameters from './ServerParameters.vue';
import PatientList from './PatientList.vue';

export default defineComponent({
  components: {
    ServerParameters,
    PatientList,
  },
});
</script>

<template>
  <div><server-parameters /> <patient-list /></div>
</template>

<style scoped></style>
