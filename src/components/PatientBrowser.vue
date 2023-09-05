<script lang="ts">
import { computed, defineComponent, ref, toRefs, watch } from 'vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
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

    const dicomStore = useDICOMStore();
    const dataStore = useDatasetStore();

    const primarySelection = computed(() => dataStore.primarySelection);

    const studies = computed(() => {
      const selPatient = patientKey.value;
      const { patientStudies, studyInfo, studyVolumes } = dicomStore;
      return (patientStudies[selPatient] ?? []).map((studyKey) => {
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

    const studyKeys = computed(() => studies.value.map((study) => study.key));
    const panels = ref<string[]>([]);

    watch(
      studyKeys,
      (keys) => {
        panels.value = Array.from(new Set([...panels.value, ...keys]));
      },
      { immediate: true }
    );

    // --- selection --- //

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
      primarySelection,
      removeSelectedStudies,
      studies,
      selectionEquals,
      setPrimarySelection: (sel: DataSelection) => {
        dataStore.setPrimarySelection(sel);
      },
      panels,
    };
  },
});
</script>

<template>
  <item-group
    :model-value="primarySelection"
    :equals-test="selectionEquals"
    @update:model-value="setPrimarySelection"
  >
    <v-container class="pa-0">
      <v-row no-gutters justify="space-between" class="mb-2">
        <v-col cols="6" align-self="center">
          <v-checkbox
            class="ml-3 align-center justify-center"
            :indeterminate="selectedSome && !selectedAll"
            label="Select All Studies"
            v-model="selectedAll"
            density="compact"
            hide-details
          />
        </v-col>
        <v-col cols="6" align-self="center" class="d-flex justify-end mt-2">
          <v-btn
            icon
            variant="text"
            :disabled="!selectedSome"
            @click.stop="removeSelectedStudies"
          >
            <v-icon>mdi-delete</v-icon>
            <v-tooltip activator="parent" location="left">
              Delete Selected
            </v-tooltip>
          </v-btn>
        </v-col>
      </v-row>
    </v-container>
    <v-expansion-panels
      v-model="panels"
      id="patient-data-studies"
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
              <v-checkbox
                class="study-selector"
                density="compact"
                hide-details
                :key="study.StudyInstanceUID"
                :value="study.StudyInstanceUID"
                v-model="selected"
                @click.stop
              />
              <v-icon>mdi-folder-table</v-icon>
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
                <v-icon small>mdi-folder-open</v-icon>
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
          <patient-study-volume-browser :volume-keys="study.volumeKeys" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </item-group>
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

.study-selector {
  flex: 0 0 auto;
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
