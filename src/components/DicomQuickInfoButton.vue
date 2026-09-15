<script setup lang="ts">
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { Maybe } from '@/src/types';
import { isDicomImage } from '@/src/utils/dataSelection';
import { computed, toRef } from 'vue';

interface Props {
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const imageId = toRef(props, 'imageId');

const dicomStore = useDICOMStore();
const dicomInfo = computed(() => {
  const volumeKey = imageId.value;
  if (volumeKey && isDicomImage(volumeKey)) {
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
    v-if="dicomInfo !== null"
    max-width="300px"
  >
    <template v-slot:activator="{ props }">
      <v-icon
        v-bind="props"
        color="white"
        size="medium"
        class="pointer-events-all dicom-info-trigger"
        @click.stop
      >
        mdi-information
      </v-icon>
    </template>
    <v-list class="dicom-info-menu">
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
.dicom-info-menu {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3);
}

.dicom-info-trigger {
  text-shadow: none;
  letter-spacing: normal;
}
</style>
