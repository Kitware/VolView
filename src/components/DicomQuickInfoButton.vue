<script setup lang="ts">
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { Maybe } from '@/src/types';
import { computed, toRef } from 'vue';

interface Props {
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const imageId = toRef(props, 'imageId');

const dicomStore = useDICOMStore();
const dicomInfo = computed(() => {
  if (imageId.value != null && imageId.value in dicomStore.imageIDToVolumeKey) {
    const volumeKey = dicomStore.imageIDToVolumeKey[imageId.value];
    const volumeInfo = dicomStore.volumeInfo[volumeKey];
    const studyKey = dicomStore.volumeStudy[volumeKey];
    const studyInfo = dicomStore.studyInfo[studyKey];
    const patientKey = dicomStore.studyPatient[studyKey];
    const patientInfo = dicomStore.patientInfo[patientKey];

    const patientID = patientInfo.PatientID;
    const studyID = studyInfo.StudyID;
    const studyDescription = studyInfo.StudyDescription;
    const seriesNumber = volumeInfo.SeriesNumber;
    const seriesDescription = volumeInfo.SeriesDescription;

    return {
      patientID,
      studyID,
      studyDescription,
      seriesNumber,
      seriesDescription,
    };
  }

  return null;
});
</script>

<template>
  <v-menu
    open-on-hover
    location="bottom left"
    left
    nudge-left="10"
    dark
    v-if="dicomInfo !== null"
    max-width="300px"
  >
    <template v-slot:activator="{ props }">
      <v-icon
        v-bind="props"
        dark
        size="x-large"
        class="pointer-events-all hover-info"
      >
        mdi-information
      </v-icon>
    </template>
    <v-list class="bg-grey-darken-3">
      <v-list-item>
        <v-list-item-title class="font-weight-bold">
          PATIENT / CASE
        </v-list-item-title>
        <v-divider />
        <v-list-item-title> ID: {{ dicomInfo.patientID }} </v-list-item-title>
      </v-list-item>
      <v-list-item>
        <v-list-item-title class="font-weight-bold"> STUDY </v-list-item-title>
        <v-divider />
        <v-list-item-title> ID: {{ dicomInfo.studyID }} </v-list-item-title>
        <v-list-item-title>
          {{ dicomInfo.studyDescription }}
        </v-list-item-title>
      </v-list-item>
      <v-list-item>
        <v-list-item-title class="font-weight-bold"> SERIES </v-list-item-title>
        <v-divider />
        <v-list-item-title>
          Series #: {{ dicomInfo.seriesNumber }}
        </v-list-item-title>
        <v-list-item-title>
          {{ dicomInfo.seriesDescription }}
        </v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style scoped src="@/src/components/styles/utils.css"></style>
<style scoped>
.hover-info {
  width: 32px;
  height: 32px;
  cursor: pointer;
}
</style>
