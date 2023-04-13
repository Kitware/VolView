<template>
  <div class="fill-height d-flex flex-column">
    <div id="module-switcher">
      <v-tabs
        id="module-switcher-tabs"
        v-model="selectedModuleIndex"
        icons-and-text
        show-arrows
      >
        <v-tab v-for="item in Modules" :key="item.name">
          <div class="tab-content">
            <span class="mb-0 mt-1 module-text">{{ item.name }}</span>
            <v-icon>mdi-{{ item.icon }}</v-icon>
          </div>
        </v-tab>
      </v-tabs>
    </div>
    <div id="module-container">
      <v-window v-model="selectedModuleIndex" touchless class="fill-height">
        <v-window-item
          v-for="mod in Modules"
          :key="mod.name"
          class="fill-height"
        >
          <component
            :key="mod.name"
            v-show="Modules[selectedModuleIndex] === mod"
            :is="mod.component"
          />
        </v-window-item>
      </v-window>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';

import DataBrowser from './DataBrowser.vue';
import RenderingModule from './RenderingModule.vue';
import AnnotationsModule from './AnnotationsModule.vue';

export const Modules = [
  {
    name: 'Data',
    icon: 'database',
    component: DataBrowser,
  },
  {
    name: 'Annotations',
    icon: 'pencil',
    component: AnnotationsModule,
  },
  {
    name: 'Rendering',
    icon: 'cube',
    component: RenderingModule,
  },
  // {
  //   name: 'AI',
  //   icon: 'robot-outline',
  //   component: null,
  // },
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
  display: relative;
  flex: 0 2;
  /* roughly match vuetify's dark/light transition */
  transition: border-bottom 0.3s;
}

.v-theme--light #module-switcher {
  border-bottom: 2px solid #efefef;
}

.v-theme--dark #module-switcher {
  border-bottom: 2px solid #2f2f2f;
}

#close-btn {
  position: absolute;
  top: 1.5em;
  left: 0.5em;
  z-index: 10;
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
  justify-content: flex-end;
  flex-direction: column-reverse;
  height: 100%;
  align-items: center;
}

#module-switcher-tabs :deep(.v-slide-group__content) {
  justify-content: center;
}

#module-switcher-tabs
  :deep(.v-slide-group__prev.v-slide-group__prev--disabled) {
  visibility: hidden;
}

#module-switcher-tabs
  :deep(.v-slide-group__next.v-slide-group__next--disabled) {
  visibility: hidden;
}
</style>
