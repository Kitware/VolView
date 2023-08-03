<script lang="ts">
import { computed, defineComponent, ref, toRefs, watch } from 'vue';
import { useDicomMetaStore } from '../../store/dicom-web/dicom-meta-store';
import { useDicomWebStore } from '../../store/dicom-web/dicom-web-store';
import StudyVolumeDicomWeb from './StudyVolumeDicomWeb.vue';

export default defineComponent({
  name: 'PatientDetails',
  props: {
    patientKey: {
      type: String,
      required: true,
    },
  },
  components: {
    StudyVolumeDicomWeb,
  },
  setup(props) {
    const { patientKey } = toRefs(props);
    const dicomStore = useDicomMetaStore();
    const dicomWebStore = useDicomWebStore();

    const isFetching = ref(true);
    dicomWebStore.fetchPatientMeta(patientKey.value).then(() => {
      isFetching.value = false;
    });

    const studies = computed(() => {
      const { patientStudies, studyInfo, studyVolumes } = dicomStore;
      return patientStudies[patientKey.value].map((studyKey) => {
        const info = studyInfo[studyKey];
        return {
          ...info,
          key: studyKey,
          title:
            info.StudyDescription || info.StudyDate || info.StudyInstanceUID,
          volumeKeys: studyVolumes[studyKey].sort(),
        };
      });
    });

    const studyKeys = computed(() => studies.value.map(({ key }) => key));
    const panels = ref<string[]>([]);

    watch(
      studyKeys,
      (keys) => {
        if (dicomWebStore.linkedToStudyOrSeries)
          panels.value = Array.from(new Set([...panels.value, ...keys]));
      },
      { immediate: true }
    );

    return {
      studies,
      isFetching,
      panels,
    };
  },
});
</script>

<template>
  <v-expansion-panels
    id="patient-data-studies"
    v-model="panels"
    accordion
    multiple
  >
    <v-expansion-panel
      v-for="study in studies"
      :key="study.StudyInstanceUID"
      :value="study.StudyInstanceUID"
      class="patient-data-study-panel"
    >
      <v-expansion-panel-title
        color="#1976fa0a"
        class="pl-3 no-select"
        :title="study.StudyDate"
      >
        <div class="study-header">
          <div class="study-header-title">
            <v-icon class="mb-2">mdi-folder-table</v-icon>
            <div class="ml-2 overflow-hidden text-no-wrap">
              <div class="text-subtitle-2 text-truncate" :title="study.title">
                {{ study.title }}
              </div>
              <div
                v-if="study.StudyDescription"
                class="text-caption text-truncate"
              >
                {{ study.StudyDate }}
              </div>
            </div>
          </div>

          <div class="d-flex flex-column align-center justify-end mx-2">
            <div class="d-flex flex-row align-center mr-2">
              <v-progress-circular
                v-if="isFetching"
                indeterminate
                :size="20"
                :width="2"
                class="mr-2"
              >
              </v-progress-circular>
              <v-icon size="small">mdi-folder-open</v-icon>
              <span class="text-caption text--secondary text-no-wrap">
                : {{ study.volumeKeys.length }}
              </span>
              <v-tooltip location="bottom" activator="parent">
                Total series in study
              </v-tooltip>
            </div>
          </div>
        </div>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <study-volume-dicom-web :volume-keys="study.volumeKeys" />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<style>
#patient-data-studies .v-expansion-panel::before {
  box-shadow: none;
}
</style>

<style scoped>
.study-header {
  display: flex;
  flex-flow: row;
  align-items: center;
  width: calc(100% - 24px);
}

.study-header-title {
  display: flex;
  flex-flow: row;
  align-items: center;
  flex-grow: 1;
  /* used to ensure that the text can truncate */
  min-width: 0;
}
</style>
