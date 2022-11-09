<script lang="ts">
import {
  computed,
  defineComponent,
  Ref,
  ref,
  watch,
} from '@vue/composition-api';
import SampleDataBrowser from './SampleDataBrowser.vue';
import ImageDataBrowser from './ImageDataBrowser.vue';
import PatientBrowser from './PatientBrowser.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import { useImageStore } from '../store/datasets-images';
import { Panel } from '../types/views';

const ANONYMOUS_COLLECTION = {
  key: 'anonymousData',
  isOpen: true,
};

export default defineComponent({
  name: 'DataBrowser',
  components: {
    SampleDataBrowser,
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

    const hasAnonymousImages = computed(
      () =>
        imageStore.idList.filter((id) => !(id in dicomStore.imageIDToVolumeKey))
          .length > 0
    );

    const sampleData = {
      key: 'sampleData',
      isOpen: true,
    };

    const panels = ref<Panel[]>([sampleData]);

    watch(
      hasAnonymousImages,
      (showAnonymous) => {
        if (showAnonymous) {
          panels.value.push({ ...ANONYMOUS_COLLECTION });
          sampleData.isOpen = false;
        } else {
          panels.value = panels.value.filter(
            ({ key }) => key !== ANONYMOUS_COLLECTION.key
          );
        }
      },
      { flush: 'post' }
    );

    watch(
      patients,
      (newPatients, oldPatients) => {
        // remove deleted
        panels.value = panels.value.filter(
          ({ key: oldKey }) =>
            newPatients.find(({ key }) => oldKey === key) ||
            [sampleData, ANONYMOUS_COLLECTION].some(({ key }) => oldKey === key)
        );

        const addedPatients = newPatients.filter(
          ({ key }) => !oldPatients.find(({ key: oldKey }) => oldKey === key)
        );
        // add to end because https://github.com/vuetifyjs/vuetify/issues/11225
        addedPatients.forEach(({ key }) => {
          panels.value.push({ key, isOpen: true });
        });

        // if loaded data, close sample data
        if (addedPatients.length > 0) sampleData.isOpen = false;
      },
      { flush: 'post' } // keeps panels open when deleting patients
    );

    const handlePanelChange = (changeKey: string) => {
      const panel = panels.value.find(({ key }) => key === changeKey);
      panel!.isOpen = !panel!.isOpen;
    };

    const openPanels: Ref<number[]> = computed(() => {
      return panels.value
        .map(({ isOpen }, idx) => ({ isOpen, idx }))
        .filter(({ isOpen }) => isOpen)
        .map(({ idx }) => idx);
    });

    return {
      openPanels,
      patients,
      deletePatient: dicomStore.deletePatient,
      hasAnonymousImages,
      handlePanelChange,
      ANONYMOUS_COLLECTION,
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
          @change="handlePanelChange(ANONYMOUS_COLLECTION.key)"
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
          @change="handlePanelChange('sampleData')"
          key="sampleData"
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
