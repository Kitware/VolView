<template>
  <div class="height-100 d-flex flex-column">
    <div id="module-switcher" class="mt-1 mb-2">
        <v-tabs
          id="module-switcher-tabs"
          v-model="selectedModuleIndex"
          icons-and-text
          :show-arrows=true
        >
          <v-tab
            v-for="item in Modules"
            :key="item.name"
            class="pl-1 pr-1"
          >
            <div class="tab-content">
              <span class="mb-0 mt-1 module-text" >{{item.name}}</span>
              <v-icon>mdi-{{ item.icon }}</v-icon>
            </div>
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
import Settings from './Settings.vue';

export const Modules = [
  {
    name: 'Sample\nData',
    icon: 'database',
    component: SampleData,
  },
  {
    name: 'Patients &\nImages',
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
    name: 'Volume\nRendering',
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
  {
    name: 'Settings',
    icon: 'cog',
    component: Settings,
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
  white-space: pre;
}

.tab-content {
  display: flex;
  padding-top: 10px;
  justify-content: flex-end;
  flex-direction: column-reverse;
  height: 100%;
  align-items: center;
}

#module-switcher-tabs >>> .v-slide-group__prev.v-slide-group__prev--disabled {
  visibility: hidden;
}

#module-switcher-tabs >>> .v-slide-group__next.v-slide-group__next--disabled {
  visibility: hidden;
}
</style>
