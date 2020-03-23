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
        no-data-text="No patient selected"
        class="no-select mt-2"
      />
    </div>
    <div id="patient-data-list">
      <v-item-group mandatory>
        <v-item
          v-for="series in seriesList"
          :key="series.instanceUID"
          v-slot:default="{ active, toggle }"
        >
          <v-card
            outlined
            width="100%"
            ripple
            :color="active ? 'light-blue accent-1' : ''"
            class="series-card"
            @click="toggle"
          >
            <v-img contain height="100px" :src="thumbnails[series.instanceUID]" />
            <v-card-text class="text--primary caption text-center">
              {{ series.description || '(no name)' }}
            </v-card-text>
          </v-card>
        </v-item>
      </v-item-group>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex';
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
  name: 'DataBrowser',

  data() {
    return {
      patientID: '',
      studyUID: '',
      thumbnails: {},
    };
  },

  computed: {
    ...mapState('datasets', {
      patients: (state) => Object.keys(state.patientIndex).map((patientID) => {
        const patient = state.patientIndex[patientID];
        return {
          id: patientID,
          label: `${patient.name} (${patient.patientID})`,
        };
      }),
      studies(state) {
        const studies = state.patientIndex[this.patientID]?.studies || [];
        return studies.map((instanceUID) => {
          const study = state.studyIndex[instanceUID];
          return {
            id: study.instanceUID,
            label: study.description || study.studyID,
          };
        });
      },
      seriesList(state) {
        const series = state.studyIndex[this.studyUID]?.series || [];
        return series.map((instanceUID) => state.seriesIndex[instanceUID]);
      },
      seriesImages: 'seriesImages',
    }),
  },

  watch: {
    patientID() {
      this.studyUID = '';
    },
    seriesList(list) {
      for (let i = 0; i < list.length; i += 1) {
        const series = list[i];
        const images = this.seriesImages[series.instanceUID];
        // pick middle image for thumbnailing
        const thumbnailTarget = images[Math.floor(images.length / 2)];
        this.thumbnailCache
          .getThumbnail(thumbnailTarget)
          .then((imageData) => {
            this.$set(this.thumbnails, series.instanceUID, generateImageURI(imageData));
          });
      }
    },
  },

  mounted() {
    this.thumbnailCache = new ThumbnailCache(100, 100);
  },
};
</script>

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

.series-card {
  display: inline-block;
  padding: 8px;
  cursor: pointer;
}
</style>
