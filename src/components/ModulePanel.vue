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
import { Component, defineComponent, ref, watch } from 'vue';

import DataBrowser from './DataBrowser.vue';
import RenderingModule from './RenderingModule.vue';
import AnnotationsModule from './AnnotationsModule.vue';
import ServerModule from './ServerModule.vue';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';

interface Module {
  name: string;
  icon: string;
  component: Component;
}

export const Modules: Module[] = [
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
];

if (import.meta.env.VITE_REMOTE_SERVER_URL) {
  Modules.push({
    name: 'Remote',
    icon: 'server-network',
    component: ServerModule,
  });
}

const autoSwitchToAnnotationsTools = [Tools.Rectangle, Tools.Ruler];

export default defineComponent({
  name: 'ModulePanel',
  setup() {
    const selectedModuleIndex = ref(0);

    const toolStore = useToolStore();
    watch(
      () => toolStore.currentTool,
      (newTool) => {
        if (autoSwitchToAnnotationsTools.includes(newTool))
          selectedModuleIndex.value = 1;
      }
    );

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
  border-bottom: 2px solid rgb(var(--v-theme-on-surface-variant));
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
