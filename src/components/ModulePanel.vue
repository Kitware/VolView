<template>
  <div class="height-100 d-flex flex-column">
    <div id="module-switcher" class="mt-1 mb-2">
        <v-tabs
          v-model="selectedModuleIndex"
          icons-and-text
          show-arrows
        >
          <v-tab
            v-for="item in Modules"
            :key="item.name"
            class="module-text"
          >
            {{ item.name }}
            <v-icon>mdi-{{ item.icon }}</v-icon>
          </v-tab>

        </v-tabs>
    </div>
    <div id="module-container">
      <v-tabs-items v-model="selectedModuleIndex">
        <v-tab-item
          v-for="mod in Modules"
          :key="mod.name"
        >
          <component
            :key="mod.name"
            v-show="Modules[selectedModuleIndex] === mod"
            :is="mod.component"
          />
        </v-tab-item>
      </v-tabs-items>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
} from '@vue/composition-api';

import PatientBrowser from '../componentsX/PatientBrowser.vue';
import VolumeRendering from '../componentsX/VolumeRendering.vue';
import SampleData from './SampleData.vue';

export const Modules = [
  {
    name: 'Sample Data',
    icon: 'database',
    component: SampleData,
  },
  {
    name: 'Patients & Images',
    icon: 'account',
    component: PatientBrowser,
  },
  {
    name: 'Annotations',
    icon: 'pencil',
    component: null,
  },
  {
    name: 'Models',
    icon: 'hexagon-multiple',
    component: null,
  },
  {
    name: 'Volume Rendering',
    icon: 'cube',
    component: VolumeRendering,
  },
  {
    name: 'Measurements',
    icon: 'pencil-ruler',
    component: null,
  },
  {
    name: 'AI',
    icon: 'robot-outline',
    component: null,
  },

];

export default defineComponent({
  name: 'ModulePanel',
  setup() {
    const selectedModuleIndex = ref(0);

    return {
      selectedModuleIndex,
      Modules,
    };
  },
});
</script>

<style scoped>
#module-switcher {
  flex: 0 2;
}

#module-container {
  position: relative;
  flex: 2;
  overflow: auto;
}

.module-text {
  font-size: 0.6rem;
}
</style>
