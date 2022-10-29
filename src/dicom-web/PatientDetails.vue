<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import ItemGroup from '@/src/components/ItemGroup.vue';
import { useDicomMetaStore } from './dicom-meta.store';
import StudyVolumeDicomWeb from './StudyVolumeDicomWeb.vue';
import { useDicomWebStore } from './dicom-web.store';

export default defineComponent({
  name: 'PatientDetails',
  props: {
    patientKey: {
      type: String,
      required: true,
    },
  },
  components: {
    ItemGroup,
    StudyVolumeDicomWeb,
  },
  setup({ patientKey }) {
    const dicomStore = useDicomMetaStore();
    const dicomWebStore = useDicomWebStore();
    dicomWebStore.fetchPatientMeta(patientKey);

    const studies = computed(() => {
      const { patientStudies, studyInfo, studyVolumes } = dicomStore;
      return patientStudies[patientKey].map((studyKey) => {
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

    return {
      studies,
    };
  },
});
</script>

<template>
  <item-group>
    <v-expansion-panels id="patient-data-studies" accordion multiple>
      <v-expansion-panel
        v-for="study in studies"
        :key="study.StudyInstanceUID"
        class="patient-data-study-panel"
      >
        <v-expansion-panel-header
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
              <v-tooltip bottom>
                Total series in study
                <template v-slot:activator="{ on }">
                  <div class="d-flex flex-row align-center mr-2" v-on="on">
                    <v-icon small>mdi-folder-open</v-icon>
                    <span class="text-caption text--secondary text-no-wrap">
                      : {{ study.volumeKeys.length }}
                    </span>
                  </div>
                </template>
              </v-tooltip>
            </div>
          </div>
        </v-expansion-panel-header>
        <v-expansion-panel-content>
          <study-volume-dicom-web :volume-keys="study.volumeKeys" />
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
  </item-group>
</template>

<style>
#patient-data-studies .v-expansion-panel--active > .v-expansion-panel-header {
  min-height: unset;
}

#patient-data-studies .v-expansion-panel-content__wrap {
  padding: 0 8px;
}

#patient-data-studies .v-expansion-panel::before {
  box-shadow: none;
}
</style>

<style scoped>
.theme--light .patient-data-study-panel {
  border: 1px solid #ddd;
}

.theme--dark .patient-data-study-panel {
  border: 1px solid #171519;
}

.volume-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  grid-auto-rows: 200px;
  justify-content: center;
}

.volume-card {
  padding: 8px;
  cursor: pointer;
}

.theme--light.volume-card-active {
  background-color: #b3e5fc;
  border-color: #b3e5fc;
}

.theme--dark.volume-card-active {
  background-color: #01579b;
  border-color: #01579b;
}

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

.study-header-content {
  overflow: hidden;
  white-space: nowrap;
}

.study-header-line {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.series-desc {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.thumbnail-overlay >>> .v-overlay__content {
  height: 100%;
  width: 100%;
}

.volume-list >>> .theme--light.v-sheet--outlined {
  border: none;
}
</style>
