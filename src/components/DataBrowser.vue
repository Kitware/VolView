<script lang="ts">
import { computed, defineComponent, ref } from '@vue/composition-api';
import SampleDataBrowser from './SampleDataBrowser.vue';
import ImageDataBrowser from './ImageDataBrowser.vue';
import { useDICOMStore } from '../store/datasets-dicom';

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

const DEFAULT_SELECTED_COLLECTION = 'all';

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
    ImageDataBrowser,
  },
  setup() {
    const dicomStore = useDICOMStore();

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

    const selectedCollectionModel = ref<string>(DEFAULT_SELECTED_COLLECTION);

    // strips off key namespace that was used to avoid key collisions
    // with the "magic" keys ("all", "images")
    const selectedCollection = computed(() => {
      if (selectedCollectionModel.value?.startsWith('#')) {
        return selectedCollectionModel.value.slice(1);
      }
      return selectedCollectionModel.value;
    });

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

    return {
      selectedCollectionModel,
      selectedCollection,
      collections,
      patients,
    };
  },
});
</script>

<template>
  <div id="data-module" class="mx-2 py-2 fill-height">
    <div id="data-collection-selector">
      <v-select
        v-model="selectedCollectionModel"
        :items="collections"
        item-text="name"
        item-value="key"
        dense
        filled
        single-line
        hide-details
        label="Select a collection"
        prepend-icon="mdi-database"
        placeholder="Select a collection"
        class="no-select"
      />
    </div>
    <div id="data-panels">
      <template v-if="selectedCollection === 'all'">
        <v-expansion-panels multiple accordion>
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
              <v-icon class="collection-header-icon">mdi-image</v-icon>
              <span>Anonymous/Other Images</span>
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <image-data-browser />
            </v-expansion-panel-content>
          </v-expansion-panel>
          <v-expansion-panel v-for="patient in patients" :key="patient.key">
            <v-expansion-panel-header>
              <div class="patient-header">
                <v-icon class="collection-header-icon">mdi-account</v-icon>
                <span>{{ patient.name }}</span>
                <v-spacer />
                <v-btn icon small class="mr-3" @click.stop>
                  <v-icon small>mdi-dots-vertical</v-icon>
                </v-btn>
              </div>
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <!--patient-data-browser :patient-key="patient.key" /-->
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>
      <template v-else-if="selectedCollection === 'samples'">
        <sample-data-browser />
      </template>
      <template v-else-if="selectedCollection === 'images'">
        <image-data-browser />
      </template>
      <template v-else>
        <!--patient-data-browser :patient-key="selectedCollection" /-->
      </template>
    </div>
  </div>
</template>

<style scoped>
#data-module {
  display: flex;
  flex-flow: column;
}

#data-collection-selector {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  padding-bottom: 12px;
}

#data-panels {
  flex: 2;
  overflow-y: auto;
}

.collection-header-icon {
  flex: 0;
  margin-right: 8px;
}

.patient-header {
  display: flex;
  flex-flow: row;
  align-items: center;
}
</style>
