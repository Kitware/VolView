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
        <template v-if="patientID === IMAGES">
          <groupable-item
            v-for="imgID in imageList"
            :key="imgID"
            v-slot="{ active, select }"
            :value="imgID"
          >
            <v-card
              outlined
              ripple
              :color="active ? 'light-blue lighten-4' : ''"
              :title="dataIndex[imgID].name"
              @click="select"
            >
              <v-container>
                <v-row no-gutters>
                  <v-col cols="4">
                    <v-img
                      contain
                      height="100px"
                      width="100px"
                      :src="getImageThumbnail(imgID)"
                    />
                  </v-col>
                  <v-col cols="8" class="text-no-wrap">
                    <div class="ml-2">
                      <div class="body-2 text-truncate">
                        {{ dataIndex[imgID].name }}
                      </div>
                      <div class="caption">
                        Dims: ({{ dataIndex[imgID].dims.join(', ') }})
                      </div>
                      <div class="caption">
                        Spacing: ({{
                          dataIndex[imgID].spacing.map((s) => s.toFixed(2)).join(', ')
                        }})
                      </div>
                    </div>
                  </v-col>
                </v-row>
              </v-container>
            </v-card>
          </groupable-item>
        </template>
        <template v-else>
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
                        :src="dicomThumbnails[series.SeriesInstanceUID]"
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
        </template>
      </item-group>
    </div>
  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';

const IMAGES = Symbol('IMAGES');
const canvas = document.createElement('canvas');

// Assume itkImage type is Uint8Array
function itkImageToURI(itkImage) {
  const [width, height] = itkImage.size;
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  const itkBuf = itkImage.data;
  for (let i = 0; i < itkBuf.length; i += 1) {
    const byte = itkBuf[i];
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(im, 0, 0);
  return canvas.toDataURL('image/png');
}

function scalarImageToURI(values, width, height, scaleMin, scaleMax) {
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  // scale to 1 unsigned byte
  const factor = 255 / (scaleMax - scaleMin);
  for (let i = 0; i < values.length; i += 1) {
    const byte = Math.floor((values[i] - scaleMin) * factor);
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(im, 0, 0);
  return canvas.toDataURL('image/png');
}

export default {
  name: 'PatientBrowser',

  components: {
    ItemGroup,
    GroupableItem,
  },

  data() {
    return {
      patientID: '',
      imageThumbnails: {}, // dataID -> Image
      dicomThumbnails: {}, // seriesUID -> Image
      pendingDicomThumbnails: {},
      IMAGES,
    };
  },

  computed: {
    ...mapState({
      selectedBaseImage: 'selectedBaseImage',
      dicomSeriesToID: 'dicomSeriesToID',
      imageList: (state) => state.data.imageIDs,
      dataIndex: (state) => state.data.index,
      vtkCache: (state) => state.data.vtkCache,
    }),
    ...mapState('dicom', {
      patientStudies: 'patientStudies',
      studySeries: 'studySeries',
      seriesIndex: 'seriesIndex',
      patients(state) {
        const patients = Object.values(state.patientIndex);
        patients.sort((a, b) => a.PatientName < b.PatientName);
        return [].concat(
          {
            id: IMAGES,
            label: 'Non-DICOM images',
          },
          patients.map((p) => ({
            id: p.PatientID,
            label: p.PatientName,
          })),
        );
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
      const seriesList = (this.studySeries[studyUID] ?? []).map(
        (seriesUID) => this.seriesIndex[seriesUID],
      );

      // trigger a background job fetch thumbnails
      this.doBackgroundDicomThumbnails(seriesList);

      return seriesList;
    },

    async setSelection(sel) {
      if (sel !== this.selectedBaseImage) {
        await this.selectBaseImage(sel);
        await this.updateScene({ reset: true });
      }
    },

    async doBackgroundDicomThumbnails(seriesList) {
      seriesList.forEach(async (series) => {
        const uid = series.SeriesInstanceUID;
        if (
          !(uid in this.dicomThumbnails || uid in this.pendingDicomThumbnails)
        ) {
          this.$set(this.pendingDicomThumbnails, uid, true);
          try {
            const middleSlice = Math.round(Number(series.NumberOfSlices) / 2);
            const thumbItkImage = await this.getSeriesImage({
              seriesKey: uid,
              slice: middleSlice,
              asThumbnail: true,
            });
            this.$set(this.dicomThumbnails, uid, itkImageToURI(thumbItkImage));
          } finally {
            delete this.pendingDicomThumbnails[uid];
          }
        }
      });
    },

    getImageThumbnail(id) {
      if (id in this.imageThumbnails) {
        return this.imageThumbnails[id];
      }
      if (id in this.vtkCache) {
        const imageData = this.vtkCache[id];
        const scalars = imageData.getPointData().getScalars();
        const dims = imageData.getDimensions();
        const length = dims[0] * dims[1];
        const sliceOffset = Math.floor(dims[2] / 2) * length;
        const slice = scalars.getData().subarray(sliceOffset, sliceOffset + length);
        const dataRange = scalars.getRange();

        const img = scalarImageToURI(slice, dims[0], dims[1], dataRange[0], dataRange[1]);
        this.$set(this.imageThumbnails, id, img);
        return img;
      }
      return '';
    },

    ...mapActions(['selectBaseImage', 'updateScene']),
    ...mapActions('dicom', ['getSeriesImage']),
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
