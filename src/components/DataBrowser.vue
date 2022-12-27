<script lang="ts">
import { computed, defineComponent, watch } from '@vue/composition-api';
import SampleDataBrowser from './SampleDataBrowser.vue';
import DicomWebBrowser from '../dicom-web/DicomWebBrowser.vue';
import { useDicomWebStore } from '../dicom-web/dicom-web.store';
import ImageDataBrowser from './ImageDataBrowser.vue';
import PatientBrowser from './PatientBrowser.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import { useImageStore } from '../store/datasets-images';
import { usePanels } from '../composables/usePanels';

const SAMPLE_DATA_KEY = 'sampleData';
const ANONYMOUS_DATA_KEY = 'anonymousData';
const DICOM_WEB_KEY = 'dicomWeb';

export default defineComponent({
  name: 'DataBrowser',
  components: {
    SampleDataBrowser,
    DicomWebBrowser,
    ImageDataBrowser,
    PatientBrowser,
  },
  setup() {
    const dicomStore = useDICOMStore();
    const imageStore = useImageStore();
    const dicomWeb = useDicomWebStore();

    // TODO show patient ID in parens if there is a name conflict
    const patients = computed(() =>
      Object.entries(dicomStore.patientInfo)
        .map(([key, info]) => ({
          key,
          name: info.PatientName,
          info,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
    );

    const hasAnonymousImages = computed(
      () =>
        imageStore.idList.filter((id) => !(id in dicomStore.imageIDToVolumeKey))
          .length > 0
    );

    const panelKeys = computed(
      () =>
        new Set([
          ...(dicomWeb.isConfigured ? [DICOM_WEB_KEY] : []),
          SAMPLE_DATA_KEY,
          ...(hasAnonymousImages.value ? [ANONYMOUS_DATA_KEY] : []),
          ...patients.value.map((study) => study.key),
        ])
    );

    const { handlePanelChange, openPanels } = usePanels(panelKeys);

    // Collapse Sample Data after loading data
    const sampleDataPanelIndex = dicomWeb.isConfigured ? 1 : 0; // if DicomWeb Panel shown at start, bump index to 1
    watch(panelKeys, (newSet, oldSet) => {
      if (
        newSet.size > oldSet.size &&
        openPanels.value.includes(sampleDataPanelIndex)
      ) {
        handlePanelChange(SAMPLE_DATA_KEY);
      }
    });

    return {
      openPanels,
      patients,
      deletePatient: dicomStore.deletePatient,
      hasAnonymousImages,
      dicomWeb,
      handlePanelChange,
      SAMPLE_DATA_KEY,
      ANONYMOUS_DATA_KEY,
      DICOM_WEB_KEY,
    };
  },
});
</script>

<template>
  <div id="data-module" class="mx-2 fill-height">
    <div id="data-panels">
      <v-expansion-panels multiple accordion :value="openPanels">
        <v-expansion-panel
          v-if="hasAnonymousImages"
          key="anonymousImages"
          @change="handlePanelChange(ANONYMOUS_DATA_KEY)"
        >
          <v-expansion-panel-header>
            <v-icon class="collection-header-icon">mdi-image</v-icon>
            <span>Anonymous</span>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <image-data-browser />
          </v-expansion-panel-content>
        </v-expansion-panel>

        <v-expansion-panel
          v-for="patient in patients"
          :key="patient.key"
          @change="handlePanelChange(patient.key)"
        >
          <v-expansion-panel-header>
            <div class="patient-header">
              <v-icon class="collection-header-icon">mdi-account</v-icon>
              <span class="patient-header-name" :title="patient.name">
                {{ patient.name }}
              </span>
              <v-spacer />
              <v-menu offset-x>
                <template v-slot:activator="{ on, attrs }">
                  <v-btn
                    icon
                    small
                    class="mr-3"
                    @click.stop
                    v-bind="attrs"
                    v-on="on"
                  >
                    <v-icon small>mdi-dots-vertical</v-icon>
                  </v-btn>
                </template>
                <v-list dense>
                  <v-list-item @click.stop="deletePatient(patient.key)">
                    <v-list-item-title>Delete Patient</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <patient-browser :patient-key="patient.key" />
          </v-expansion-panel-content>
        </v-expansion-panel>

        <v-expansion-panel
          v-if="dicomWeb.isConfigured"
          key="dicomWeb"
          @change="handlePanelChange(DICOM_WEB_KEY)"
        >
          <v-expansion-panel-header>
            <v-icon class="collection-header-icon">mdi-cloud-download</v-icon>
            <span>DICOMWeb</span>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <dicom-web-browser />
          </v-expansion-panel-content>
        </v-expansion-panel>

        <v-expansion-panel
          key="sampleData"
          @change="handlePanelChange(SAMPLE_DATA_KEY)"
        >
          <v-expansion-panel-header>
            <v-icon class="collection-header-icon">mdi-card-bulleted</v-icon>
            <span>Sample Data</span>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <sample-data-browser />
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>
  </div>
</template>

<style scoped>
#data-module {
  display: flex;
  flex-flow: column;
}

#data-panels {
  flex: 2;
  overflow-y: auto;
}

.collection-header-icon {
  flex: 0;
  margin-right: 16px;
}

.patient-header {
  display: flex;
  flex-flow: row;
  align-items: center;
  /* 24px accomodates the open/close icon indicator */
  max-width: calc(100% - 24px);
}

.patient-header-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
