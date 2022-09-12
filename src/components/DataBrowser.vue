<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import SampleDataBrowser from './SampleDataBrowser.vue';
import DicomWebLoader from './DicomWebLoader.vue';
import ImageDataBrowser from './ImageDataBrowser.vue';
import PatientBrowser from './PatientBrowser.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import { useImageStore } from '../store/datasets-images';

type Collection =
  | {
      name: string;
      key: string;
      disabled?: boolean;
    }
  | {
      divider: boolean;
    }
  | {
      header: string;
    };

const DEFAULT_COLLECTIONS: Collection[] = [
  {
    name: 'All Data',
    key: 'all',
  },
  {
    name: 'Sample Data',
    key: 'samples',
  },
  {
    name: 'Anonymous/Misc. Images',
    key: 'images',
  },
  {
    divider: true,
  },
  {
    header: 'Patients',
  },
];

export default defineComponent({
  name: 'DataBrowser',
  components: {
    SampleDataBrowser,
    DicomWebLoader,
    ImageDataBrowser,
    PatientBrowser,
  },
  setup() {
    const dicomStore = useDICOMStore();
    const imageStore = useImageStore();

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

    // --- collection handling --- //

    const collections = computed(() => {
      const patientItems: Collection[] = patients.value.map((patient) => ({
        name: patient.name,
        // namespace key so patient.key doesn't conflict with
        // the keys from DEFAULT_COLLECTIONS
        key: `#${patient.key}`,
      }));
      if (!patientItems.length) {
        patientItems.push({
          name: 'No Patients',
          key: 'no-patients',
          disabled: true,
        });
      }
      return [...DEFAULT_COLLECTIONS, ...patientItems];
    });

    const hasAnonymousImages = computed(
      () =>
        imageStore.idList.filter((id) => !(id in dicomStore.imageIDToVolumeKey))
          .length > 0
    );

    return {
      collections,
      patients,
      deletePatient: dicomStore.deletePatient,
      hasAnonymousImages,
    };
  },
});
</script>

<template>
  <div id="data-module" class="mx-2 fill-height">
    <div id="data-panels">
      <v-expansion-panels multiple accordion>
        <v-expansion-panel v-if="hasAnonymousImages">
          <v-expansion-panel-header>
            <v-icon class="collection-header-icon">mdi-image</v-icon>
            <span>Anonymous</span>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <image-data-browser />
          </v-expansion-panel-content>
        </v-expansion-panel>
        <v-expansion-panel v-for="patient in patients" :key="patient.key">
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
        <v-expansion-panel>
          <v-expansion-panel-header>
            <v-icon class="collection-header-icon">mdi-card-bulleted</v-icon>
            <span>Sample Data</span>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <sample-data-browser />
          </v-expansion-panel-content>
        </v-expansion-panel>
        
        <v-expansion-panel>
          <v-expansion-panel-header>
            <v-icon class="collection-header-icon">mdi-card-bulleted</v-icon>
            <span>DICOMWeb</span>
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <dicom-web-loader />
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
