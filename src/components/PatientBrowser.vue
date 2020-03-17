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
        class="no-select"
      />
      <v-select
        v-model="studyUID"
        :items="studies"
        item-text="label"
        item-value="id"
        dense
        filled
        single-line
        hide-details
        label="Study"
        prepend-icon="mdi-folder-table"
        class="no-select mt-2"
      />
    </div>
    <div id="patient-data-list">
      <v-expansion-panels accordion multiple id="patient-data-list-panels">
        <template v-for="(series, i) in seriesList">
          <v-expansion-panel :key="i">
            <v-expansion-panel-header color="#1976fa0a" class="no-select subtitle-2">
              <v-row no-gutters align="center">
                <v-col>{{ series.description }}</v-col>
                <!--
                <v-col>({{ seriesImages[series.instanceUID].length }} images)</v-col>
                -->
              </v-row>
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <div class="d-flex flex-row flex-wrap ma-2">
                <template v-for="(image, i) in seriesImages[series.instanceUID]">
                  <img :key="i" class="meow" :src="imageToDataURL(image)" />
                </template>
              </div>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </template>
      </v-expansion-panels>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';

const $canvas = document.createElement('canvas');

function imageToDataURL(image) {
  $canvas.width = image.cols;
  $canvas.height = image.rows;
  const ctx = $canvas.getContext('2d');
  const imageData = ctx.createImageData($canvas.width, $canvas.height);
  for (let i = 0, si = 0; i < image.pixelData.length; i += 1, si += 4) {
    const pixel = Math.floor(255 * ((image.pixelData[i] - image.minValue) / image.maxValue));
    imageData.data[si + 0] = pixel;
    imageData.data[si + 1] = pixel;
    imageData.data[si + 2] = pixel;
    imageData.data[si + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return $canvas.toDataURL('image/png');
}

export default {
  name: 'DataBrowser',

  data() {
    return {
      patientID: '',
      studyUID: '',
    };
  },

  computed: {
    ...mapState('datasets', {
      patients: (state) => state.patients.map((patient) => ({
        id: patient.patientID,
        label: `${patient.name} (${patient.patientID})`,
      })),
      studies(state) {
        return (state.patientStudies[this.patientID] || []).map((study) => ({
          id: study.instanceUID,
          label: `${study.description}`,
        }));
      },
      seriesList(state) {
        return (state.studySeries[this.studyUID] || []);
      },
      seriesImages: 'seriesImages',
    }),
  },

  watch: {
    patientID() {
      this.studyUID = '';
    },
  },

  methods: {
    imageToDataURL,
  },
};
</script>

<style>
#patient-data-list-panels .v-expansion-panel--active > .v-expansion-panel-header {
  /* don't grow expansion panel when opened */
  min-height: unset;
}

#patient-data-list-panels .v-expansion-panel--active > .v-expansion-panel-header {
  /* don't grow expansion panel when opened */
  min-height: unset;
}

#patient-data-list-panels .v-expansion-panel-content__wrap {
  /* reduce content padding */
  padding: 0 8px;
}

#patient-data-list-panels .v-expansion-panel::before {
  /* no drop-shadow */
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

#patient-data-list-panels {
  width: calc(100% - 0px);
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.meow {
  width: 50px;
  height: 50px;
  background: grey;
  margin: 4px;
}
</style>
