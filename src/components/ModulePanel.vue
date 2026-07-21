<template>
  <div class="fill-height d-flex flex-column">
    <div id="module-switcher">
      <v-tabs
        id="module-switcher-tabs"
        v-model="selectedModule"
        grow
        icons-and-text
        show-arrows
      >
        <v-tab
          v-for="item in modules"
          :key="item.name"
          :value="item.name"
          :data-testid="`module-tab-${item.name}`"
          :disabled="item.disabled"
        >
          <div class="tab-content">
            <span class="mb-0 mt-1 module-text">{{ item.name }}</span>
            <v-icon>mdi-{{ item.icon }}</v-icon>
          </div>
        </v-tab>
      </v-tabs>
    </div>
    <div id="module-container">
      <v-window v-model="selectedModule" touchless class="module-window">
        <v-window-item
          v-for="mod in modules"
          :key="mod.name"
          :value="mod.name"
          class="module-window-item"
        >
          <component
            :key="mod.name"
            v-show="selectedModule === mod.name"
            :is="mod.component"
          />
        </v-window-item>
      </v-window>
    </div>
    <ProbeView />
  </div>
</template>

<script lang="ts">
import { Component, computed, defineComponent, ref, watch } from 'vue';

import { ConnectionState, useServerStore } from '@/src/store/server';
import { JobsModule, useProcessingJobsStore } from '@/src/processing';
import DataBrowser from './DataBrowser.vue';
import RenderingModule from './RenderingModule.vue';
import AnnotationsModule from './AnnotationsModule.vue';
import ServerModule from './ServerModule.vue';
import ProbeView from './ProbeView.vue';
import { useToolStore } from '../store/tools';
import { Tools } from '../store/tools/types';

type Module = {
  name: string;
  icon: string;
  component: Component;
  disabled?: boolean;
};

const CoreModules: Module[] = [
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

const RemoteModule: Module = {
  name: 'Remote',
  icon: 'server-network',
  component: ServerModule,
};

const autoSwitchToAnnotationsTools = [
  Tools.Rectangle,
  Tools.Ruler,
  Tools.Polygon,
  Tools.Paint,
];

export default defineComponent({
  name: 'ModulePanel',
  components: { ProbeView },
  setup() {
    const selectedModule = ref(CoreModules[0].name);

    const toolStore = useToolStore();
    watch(
      () => toolStore.currentTool,
      (newTool) => {
        if (autoSwitchToAnnotationsTools.includes(newTool))
          selectedModule.value = 'Annotations';
      }
    );

    const serverStore = useServerStore();

    // Jobs tab appears only after a provider registers.
    const providersStore = useProcessingJobsStore();
    const jobsModule = computed(() =>
      providersStore.configs.size > 0
        ? ({ name: 'Jobs', icon: 'creation', component: JobsModule } as Module)
        : null
    );

    const modules = computed(() => {
      const filtered = [
        ...CoreModules,
        ...(jobsModule.value ? [jobsModule.value] : []),
        RemoteModule,
      ];

      if (!serverStore.url) {
        return filtered.filter((m) => m.name !== 'Remote');
      }

      if (serverStore.connState === ConnectionState.Connected) {
        return filtered;
      }

      return filtered.map((m) => {
        if (m.name === 'Remote') {
          return { ...m, disabled: true };
        }
        return m;
      });
    });

    watch(
      modules,
      (available) => {
        const selected = available.find(
          (item) => item.name === selectedModule.value
        );
        if (!selected || selected.disabled) {
          selectedModule.value =
            available.find((item) => !item.disabled)?.name ??
            CoreModules[0].name;
        }
      },
      { immediate: true }
    );

    return {
      selectedModule,
      modules,
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
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.module-window,
.module-window-item {
  min-height: 100%;
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

#module-switcher-tabs :deep(.v-tab.v-tab) {
  flex: 1 1 0;
  min-width: 0;
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
