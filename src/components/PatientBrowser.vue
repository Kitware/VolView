<script lang="ts">
import { computed, defineComponent, ref, toRefs } from '@vue/composition-api';
import type { Ref } from '@vue/composition-api';
import ItemGroup from '@/src/components/ItemGroup.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
  DICOMSelection,
  selectionEquals,
  useDatasetStore,
} from '../store/datasets';
import { useMultiSelection } from '../composables/useMultiSelection';
import PatientStudyVolumeBrowser from './PatientStudyVolumeBrowser.vue';

export default defineComponent({
  name: 'PatientBrowser',
  props: {
    patientKey: {
      type: String,
      required: true,
    },
  },
  components: {
    ItemGroup,
    PatientStudyVolumeBrowser,
  },
  setup(props) {
    const { patientKey } = toRefs(props);

    const selectedSeries: Ref<DICOMSelection[]> = ref([]);

    const dicomStore = useDICOMStore();
    const dataStore = useDatasetStore();

    const primarySelection = computed(() => dataStore.primarySelection);

    const studies = computed(() => {
      const selPatient = patientKey.value;
      const { patientStudies, studyInfo, studyVolumes } = dicomStore;
      return patientStudies[selPatient].map((studyKey) => {
        const info = studyInfo[studyKey];
        return {
          ...info,
          key: studyKey,
          title:
            info.StudyDescription || info.StudyDate || info.StudyInstanceUID,
          volumeKeys: studyVolumes[studyKey],
        };
      });
    });

    // --- selection --- //

    const studyKeys = computed(() => studies.value.map((study) => study.key));
    const { selected, selectedAll, selectedSome } =
      useMultiSelection(studyKeys);

    const removeSelectedStudies = () => {
      selected.value.forEach(async (study) => {
        dicomStore.deleteStudy(study);
      });
      selected.value = [];

      // Handle the case where we are deleting the selected study
      // if (selected.value.indexOf(selectedStudy.value) !== -1) {
      //   dataStore.setPrimarySelection(null);
      // }
    };

    return {
      selected,
      selectedAll,
      selectedSome,
      selectedSeries,
      primarySelection,
      removeSelectedStudies,
      studies,
      selectionEquals,
      setPrimarySelection: (sel: DataSelection) => {
        dataStore.setPrimarySelection(sel);
      },
    };
  },
});
</script>

<template>
  <item-group
    :value="primarySelection"
    :testFunction="selectionEquals"
    @change="setPrimarySelection"
  >
    <v-container class="pa-0">
      <v-row no-gutters justify="space-between">
        <v-col cols="6" align-self="center">
          <v-checkbox
            class="ml-3 align-center justify-center"
            :indeterminate="selectedSome && !selectedAll"
            label="Select All Studies"
            v-model="selectedAll"
          ></v-checkbox>
        </v-col>
        <v-col cols="6" align-self="center" class="d-flex justify-end">
          <v-tooltip left>
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                icon
                :disabled="!selectedSome"
                @click.stop="removeSelectedStudies"
                v-bind="attrs"
                v-on="on"
              >
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </template>
            Delete selected
          </v-tooltip>
        </v-col>
      </v-row>
    </v-container>
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
              <v-checkbox
                dense
                :key="study.StudyInstanceUID"
                :value="study.StudyInstanceUID"
                v-model="selected"
                @click.stop
              />
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
          <patient-study-volume-browser :volume-keys="study.volumeKeys" />
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
