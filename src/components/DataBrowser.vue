<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';
import { isRegularImage } from '@/src/utils/dataSelection';
import SampleDataBrowser from './SampleDataBrowser.vue';
import { useDicomWebStore } from '../store/dicom-web/dicom-web-store';
import ImageDataBrowser from './ImageDataBrowser.vue';
import PatientBrowser from './PatientBrowser.vue';
import PatientList from './dicom-web/PatientList.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import { useImageStore } from '../store/datasets-images';
import { useDataBrowserStore } from '../store/data-browser';
import { useDatasetStore } from '../store/datasets';
import { removeFromArray } from '../utils';

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
    const dataBrowserStore = useDataBrowserStore();
    const datasetStore = useDatasetStore();

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
      () => imageStore.idList.filter((id) => isRegularImage(id)).length > 0
    );

    const panels = ref<string[]>([SAMPLE_DATA_KEY]);

    watch(patients, (newPatients, oldPatients) => {
      // Remove from panels to avoid error in vuetify group.ts
      oldPatients.forEach((oldPatient) => {
        if (!newPatients.find((p) => p.key === oldPatient.key)) {
          removeFromArray(panels.value, oldPatient.key);
        }
      });
    });

    const hideSampleData = computed(() => dataBrowserStore.hideSampleData);
    watch(hideSampleData, (hide) => {
      if (hide) {
        // Remove from panels to avoid error in vuetify group.ts
        removeFromArray(panels.value, SAMPLE_DATA_KEY);
      }
    });

    const openDicomWeb = computed(() => dicomWeb.isConfigured);
    watch(
      openDicomWeb,
      (configured) => {
        if (configured) {
          panels.value.push(DICOM_WEB_KEY);
        } else {
          // Remove from panels to avoid error in vuetify group.ts
          removeFromArray(panels.value, DICOM_WEB_KEY);
        }
      },
      { immediate: true }
    );

    watch(
      [hasAnonymousImages, patients] as const,
      ([showAnonymous, patients_]) => {
        const showPatients = patients_.length > 0;
        if (showAnonymous) {
          panels.value.push(ANONYMOUS_DATA_KEY);
        }
        if (showPatients) {
          panels.value.push(...patients_.map((patient) => patient.key));
        }
        if (showAnonymous || showPatients) {
          removeFromArray(panels.value, SAMPLE_DATA_KEY);
        }
      }
    );

    const deletePatient = (key: string) => {
      dicomStore.patientStudies[key]
        .flatMap((study) => dicomStore.studyVolumes[study])
        .forEach(datasetStore.remove);
    };

    return {
      panels,
      patients,
      deletePatient,
      hasAnonymousImages,
      dicomWeb,
      SAMPLE_DATA_KEY,
      ANONYMOUS_DATA_KEY,
      DICOM_WEB_KEY,
      hideSampleData,
    };
  },
});
</script>

<template>
  <div id="data-module" class="mx-1 fill-height">
    <div id="data-panels">
      <v-expansion-panels
        v-model="panels"
        multiple
        variant="accordion"
        class="no-panels"
      >
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
            <span class="text-truncate">
              {{ `${dicomWeb.hostName || dicomWeb.host} | DICOMWeb` }}
            </span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <patient-list />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel v-if="!hideSampleData" :value="SAMPLE_DATA_KEY">
          <v-expansion-panel-title>
            <v-icon class="collection-header-icon">mdi-card-bulleted</v-icon>
            <span>Sample Data</span>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <sample-data-browser />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
      <div class="empty-state ma-4 text-center">No data loaded</div>
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

.empty-state {
  display: none;
}

.no-panels:empty + .empty-state {
  display: block;
}
</style>
