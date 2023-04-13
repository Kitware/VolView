<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import SampleDataBrowser from './SampleDataBrowser.vue';
import { useDicomWebStore } from '../store/dicom-web/dicom-web-store';
import ImageDataBrowser from './ImageDataBrowser.vue';
import PatientBrowser from './PatientBrowser.vue';
import PatientList from './dicom-web/PatientList.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import { useImageStore } from '../store/datasets-images';

const SAMPLE_DATA_KEY = 'sampleData';
const ANONYMOUS_DATA_KEY = 'anonymousData';
const DICOM_WEB_KEY = 'dicomWeb';

export default defineComponent({
  name: 'DataBrowser',
  components: {
    SampleDataBrowser,
    ImageDataBrowser,
    PatientBrowser,
    PatientList,
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

    // TODO Collapse Sample Data after loading data

    const panels = ref<string[]>([SAMPLE_DATA_KEY]);

    return {
      panels,
      patients,
      deletePatient: dicomStore.deletePatient,
      hasAnonymousImages,
      dicomWeb,
      SAMPLE_DATA_KEY,
      ANONYMOUS_DATA_KEY,
      DICOM_WEB_KEY,
    };
  },
});
</script>

<template>
  <div id="data-module" class="mx-1 fill-height">
    <div id="data-panels">
      <v-expansion-panels v-model="panels" multiple variant="accordion">
        <v-expansion-panel
          v-if="hasAnonymousImages"
          :value="ANONYMOUS_DATA_KEY"
        >
          <v-expansion-panel-title>
            <v-icon class="collection-header-icon">mdi-image</v-icon>
            <span>Anonymous</span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <image-data-browser />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel
          v-for="patient in patients"
          :key="patient.key"
          :value="patient.key"
        >
          <v-expansion-panel-title>
            <div class="patient-header">
              <v-icon class="collection-header-icon">mdi-account</v-icon>
              <span class="patient-header-name" :title="patient.name">
                {{ patient.name }}
              </span>
              <v-spacer />
              <v-menu offset-x>
                <template v-slot:activator="{ props }">
                  <v-btn
                    v-bind="props"
                    variant="text"
                    icon="mdi-dots-vertical"
                    size="small"
                    class="mr-3"
                    @click.stop
                  />
                </template>
                <v-list density="compact">
                  <v-list-item @click.stop="deletePatient(patient.key)">
                    <v-list-item-title>Delete Patient</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <patient-browser :patient-key="patient.key" />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel v-if="dicomWeb.isConfigured" :value="DICOM_WEB_KEY">
          <v-expansion-panel-title>
            <v-icon class="collection-header-icon">mdi-cloud-download</v-icon>
            <span>
              {{ `${dicomWeb.hostName || dicomWeb.host} | DICOMWeb` }}
            </span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <patient-list />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel :value="SAMPLE_DATA_KEY">
          <v-expansion-panel-title>
            <v-icon class="collection-header-icon">mdi-card-bulleted</v-icon>
            <span>Sample Data</span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <sample-data-browser />
          </v-expansion-panel-text>
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
  width: 100%;
  /* 24px accomodates the open/close icon indicator */
  max-width: calc(100% - 24px);
}

.patient-header-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
