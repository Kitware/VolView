<template>
  <div id="patient-module" class="mx-2 height-100">
    <div id="patient-filter-controls">
      <v-select
        v-model="patientID"
        :items="patients"
        item-text="label"
        item-value="id"
        dense
        filled
        single-line
        hide-details
        label="Patient"
        prepend-icon="mdi-account"
        no-data-text="No patients loaded"
        placeholder="Select a patient"
        class="no-select"
      />
    </div>
    <div id="patient-data-list">
      <item-group
        :value="selectedBaseImage"
        @change="setSelection"
      >
        <v-expansion-panels id="patient-data-studies" accordion multiple>
          <v-expansion-panel
            v-for="study in studies"
            :key="study.StudyInstanceUID"
            class="patient-data-study-panel"
          >
            <v-expansion-panel-header
              color="#1976fa0a"
              class="no-select"
              :title="study.StudyDate"
            >
              <v-icon class="ml-n3 pr-3">mdi-folder-table</v-icon>
              <div class="study-header">
                <div class="subtitle-2 study-header-line">
                  {{ study.StudyDescription || study.StudyDate }}
                </div>
                <div v-if="study.StudyDescription" class="caption study-header-line">
                  {{ study.StudyDate }}
                </div>
              </div>
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <div class="my-2 series-list">
                <groupable-item
                  v-for="series in getSeries(study.StudyInstanceUID)"
                  :key="series.SeriesInstanceUID"
                  v-slot:default="{ active, select }"
                  :value="dicomSeriesToID[series.SeriesInstanceUID]"
                >
                  <v-card
                    outlined
                    ripple
                    :color="active ? 'light-blue lighten-4' : ''"
                    class="series-card"
                    :title="series.SeriesDescription"
                    @click="select"
                  >
                    <v-img
                      contain
                      height="100px"
                    />
                    <v-card-text class="text--primary caption text-center series-desc mt-n3">
                      <div>[{{ series.NumberOfSlices }}]</div>
                      <div class="text-ellipsis">
                        {{ series.SeriesDescription || '(no description)' }}
                      </div>
                    </v-card-text>
                  </v-card>
                </groupable-item>
              </div>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>

      </item-group>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';

export default {
  name: 'PatientBrowser',

  components: {
    ItemGroup,
    GroupableItem,
  },

  data() {
    return {
      patientID: '',
    };
  },

  computed: {
    ...mapState('datasets', ['selectedBaseImage', 'dicomSeriesToID']),
    ...mapState('datasets/dicom', {
      patientStudies: 'patientStudies',
      studySeries: 'studySeries',
      seriesIndex: 'seriesIndex',
      patients(state) {
        const patients = Object.values(state.patientIndex);
        patients.sort((a, b) => a.PatientName < b.PatientName);
        return patients.map((p) => ({
          id: p.PatientID,
          label: p.PatientName,
        }));
      },
      studies(state) {
        const studyKeys = state.patientStudies[this.patientID] ?? [];
        return studyKeys
          .map((key) => state.studyIndex[key])
          .filter(Boolean);
      },
    }),
  },

  watch: {
    patients() {
      // if patient index is updated, then try to select first one
      if (!this.patientID) {
        if (this.patients.length) {
          this.patientID = this.patients[0].id;
        } else {
          this.patientID = '';
        }
      }
    },
  },

  methods: {
    getSeries(studyUID) {
      return (this.studySeries[studyUID] ?? []).map(
        (seriesUID) => this.seriesIndex[seriesUID],
      );
    },
    setSelection(sel) {
      console.log('setSelection', sel);
    },
  },
};
</script>

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
#patient-module {
  display: flex;
  flex-flow: column;
}

#patient-filter-controls {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  padding-bottom: 12px;
}

#patient-data-list {
  flex: 2;
  margin-top: 12px;
  overflow-y: scroll;
}

.patient-data-study-panel {
  border: 1px solid #ddd;
}

.series-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  grid-template-rows: 180px;
  justify-content: center;
}

.series-card {
  padding: 8px;
  cursor: pointer;
}

.study-header {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.study-header-line {
  width: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
}

.series-desc {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
