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
      <v-item-group
        :value="selection"
        @change="setSelection"
      >
        <v-expansion-panels id="patient-data-studies" accordion multiple>
          <v-expansion-panel
            v-for="study in getStudies(patientID)"
            :key="study.instanceUID"
            class="patient-data-study-panel"
          >
            <v-expansion-panel-header
              color="#1976fa0a"
              class="no-select"
              :title="`${study.description || ''} (${study.date.toDateString()})`"
            >
              <v-icon class="ml-n3 pr-3">mdi-folder-table</v-icon>
              <div class="study-header">
                <div class="subtitle-2 study-header-line">
                  {{ study.description || study.date.toDateString() }}
                </div>
                <div v-if="study.description" class="caption study-header-line">
                  {{ study.date.toDateString() }}
                </div>
              </div>
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <div class="my-2 series-list">
                <v-item
                  v-for="series in getSeries(study.instanceUID)"
                  :key="series.instanceUID"
                  v-slot:default="{ active, toggle }"
                  :value="`${study.instanceUID}::${series.instanceUID}`"
                >
                  <v-card
                    outlined
                    ripple
                    :color="active ? 'light-blue lighten-4' : ''"
                    class="series-card"
                    :title="series.description"
                    @click="toggle"
                  >
                    <v-img
                      contain
                      height="100px"
                      :src="thumbnails[series.instanceUID]"
                    />
                    <v-card-text class="text--primary caption text-center series-desc mt-n3">
                      <div>[{{ seriesImages[series.instanceUID].length }}]</div>
                      <div class="text-ellipsis">
                        {{ series.description || '(no description)' }}
                      </div>
                    </v-card-text>
                  </v-card>
                </v-item>
              </div>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>

      </v-item-group>
    </div>
  </div>
</template>

<script>
import { mapState, mapActions, mapGetters } from 'vuex';
import ThumbnailCache from '@/src/io/dicom/thumbnailCache';

const $canvas = document.createElement('canvas');

function generateImageURI(imageData) {
  $canvas.width = imageData.width;
  $canvas.height = imageData.height;
  const ctx = $canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  return $canvas.toDataURL('image/png');
}

export default {
  name: 'PatientBrowser',

  data() {
    return {
      patientID: '',
      thumbnails: {},
    };
  },

  computed: {
    ...mapGetters('datasets', ['selectedDicomStudyUID', 'selectedDicomSeriesUID']),
    ...mapState('datasets', {
      patients: (state) => Object.keys(state.patientIndex).map((patientID) => {
        const patient = state.patientIndex[patientID];
        return {
          id: patientID,
          label: `${patient.name} (${patient.patientID})`,
        };
      }),
      patientIndex: 'patientIndex',
      studyIndex: 'studyIndex',
      seriesIndex: 'seriesIndex',
      seriesImages: 'seriesImages',
    }),
    selection() {
      const studyUID = this.selectedDicomStudyUID;
      const seriesUID = this.selectedDicomSeriesUID;
      // :: is used as the separator for the v-item value
      return studyUID && seriesUID ? `${studyUID}::${seriesUID}` : null;
    },
  },

  watch: {
    patientIndex(index) {
      // if patient index is updated, then try to select first one
      if (!this.patientID) {
        [this.patientID] = Object.keys(index);
      }
    },
    patientID(patientID) {
      const studies = this.getStudies(patientID);
      for (let i = 0; i < studies.length; i += 1) {
        const seriesList = this.getSeries(studies[i].instanceUID);
        for (let j = 0; j < seriesList.length; j += 1) {
          const series = seriesList[j];
          const images = this.seriesImages[series.instanceUID];
          // pick middle image for thumbnailing
          // TODO allow this to be configurable (e.g. through context menu)
          const thumbnailTarget = images[Math.floor(images.length / 2)];
          this.thumbnailCache
            .getThumbnail(thumbnailTarget)
            .then((imageData) => {
              this.$set(this.thumbnails, series.instanceUID, generateImageURI(imageData));
            });
        }
      }
    },
  },

  mounted() {
    this.thumbnailCache = new ThumbnailCache(100, 100);
  },

  methods: {
    ...mapActions('datasets', ['selectSeries']),
    getStudies(patientID) {
      return (this.patientIndex[patientID]?.studies ?? []).map(
        (studyUID) => this.studyIndex[studyUID],
      );
    },
    getSeries(studyUID) {
      return (this.studyIndex[studyUID]?.series ?? []).map(
        (seriesUID) => this.seriesIndex[seriesUID],
      );
    },
    setSelection(sel) {
      if (sel) {
        // :: is used as the separator for the v-item value
        const [studyUID, seriesUID] = sel.split('::');
        this.selectSeries([studyUID, seriesUID]);
      }
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
