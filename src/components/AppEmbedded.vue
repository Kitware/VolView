<template>
  <drag-and-drop enabled @drop-files="loadFiles" class="volview-embedded">
    <template v-slot="{ dragHover }">
      <div class="volview-container">
        <!-- Navigation drawer sin app prop para evitar conflictos -->
        <div 
          v-if="leftSideBar" 
          class="volview-sidebar"
          :class="{ 'volview-sidebar--mobile': mobile }"
        >
          <module-panel @close="leftSideBar = false" />
        </div>
        
        <!-- Contenido principal sin v-main para evitar conflictos -->
        <div class="volview-main" :class="{ 'volview-main--with-sidebar': leftSideBar }">
          <div class="volview-header">
            <v-btn 
              icon="mdi-menu" 
              size="small"
              variant="text"
              @click="leftSideBar = !leftSideBar"
              class="volview-menu-btn"
            />
            <span class="volview-title">VolView</span>
          </div>
          
          <div class="volview-content">
            <div class="fill-height d-flex flex-row flex-grow-1">
              <controls-strip :has-data="hasData"></controls-strip>
              <div class="d-flex flex-column flex-grow-1">
                <layout-grid v-show="hasData" :layout="layout" />
                <welcome-page
                  v-if="!hasData"
                  :loading="showLoading"
                  class="clickable"
                  @click="loadUserPromptedFiles"
                >
                </welcome-page>
              </div>
            </div>
          </div>
        </div>
        
        <controls-modal />
      </div>
      
      <persistent-overlay
        :disabled="!dragHover"
        color="#000"
        :opacity="0.3"
        :z-index="1000"
        class="text-center volview-overlay"
      >
        <div class="d-flex flex-column align-center justify-center h-100">
          <div class="dnd-prompt">
            <v-icon size="4.75rem">mdi-download</v-icon>
            <div class="text-h6 font-weight-bold">Drop your files to open</div>
          </div>
        </div>
      </persistent-overlay>
    </template>
  </drag-and-drop>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { UrlParams } from '@vueuse/core';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { useDisplay } from 'vuetify';
import useLoadDataStore from '@/src/store/load-data';
import { useViewStore } from '@/src/store/views';
import useRemoteSaveStateStore from '@/src/store/remote-save-state';
import ControlsStrip from '@/src/components/ControlsStrip.vue';
import {
  loadFiles,
  loadUserPromptedFiles,
  loadUrls,
} from '@/src/actions/loadUserFiles';
import WelcomePage from '@/src/components/WelcomePage.vue';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import LayoutGrid from '@/src/components/LayoutGrid.vue';
import ModulePanel from '@/src/components/ModulePanel.vue';
import DragAndDrop from '@/src/components/DragAndDrop.vue';
import PersistentOverlay from '@/src/components/PersistentOverlay.vue';
import ControlsModal from '@/src/components/ControlsModal.vue';
import { useImageStore } from '@/src/store/datasets-images';
import { useServerStore } from '@/src/store/server';
import { useGlobalErrorHook } from '@/src/composables/useGlobalErrorHook';
import { useKeyboardShortcuts } from '@/src/composables/useKeyboardShortcuts';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  populateAuthorizationToken,
  stripTokenFromUrl,
} from '@/src/utils/token';
import { defaultImageMetadata } from '@/src/core/progressiveImage';

export default defineComponent({
  name: 'AppEmbedded',

  components: {
    ControlsStrip,
    LayoutGrid,
    DragAndDrop,
    ModulePanel,
    PersistentOverlay,
    ControlsModal,
    WelcomePage,
  },

  setup() {
    const imageStore = useImageStore();
    const dicomStore = useDICOMStore();

    useGlobalErrorHook();
    useKeyboardShortcuts();

    // --- file handling --- //

    const loadDataStore = useLoadDataStore();
    const hasData = computed(
      () =>
        imageStore.idList.length > 0 ||
        Object.keys(dicomStore.volumeInfo).length > 0
    );
    // show loading if actually loading or has any data,
    // since the welcome screen shouldn't be visible when
    // a dataset is opened.
    const showLoading = computed(
      () => loadDataStore.isLoading || hasData.value
    );

    const { currentImageMetadata, isImageLoading } = useCurrentImage();
    const defaultImageMetadataName = defaultImageMetadata().name;
    watch(currentImageMetadata, (newMetadata) => {
      let prefix = '';
      if (
        newMetadata?.name &&
        // wait until we get a real name, but if we never do, show default name
        (newMetadata.name !== defaultImageMetadataName || !isImageLoading)
      ) {
        prefix = `${newMetadata.name} -`;
      }
      // No cambiar el título del documento en modo embebido
      // document.title = `${prefix}VolView`;
    });

    // --- parse URL -- //

    populateAuthorizationToken();
    stripTokenFromUrl();

    const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

    onMounted(() => {
      if (!urlParams.urls) {
        return;
      }

      loadUrls(urlParams);
    });

    // --- remote server --- //

    const serverStore = useServerStore();

    onMounted(() => {
      serverStore.connect();
    });

    // --- save state --- //
    if (import.meta.env.VITE_ENABLE_REMOTE_SAVE && urlParams.save) {
      const url = Array.isArray(urlParams.save)
        ? urlParams.save[0]
        : urlParams.save;
      useRemoteSaveStateStore().setSaveUrl(url);
    }

    // --- layout --- //

    const { layout } = storeToRefs(useViewStore());

    // --- //

    const display = useDisplay();

    return {
      leftSideBar: ref(!display.mobile.value),
      mobile: computed(() => display.mobile.value),
      loadUserPromptedFiles,
      loadFiles,
      hasData,
      showLoading,
      layout,
    };
  },
});
</script>

<style scoped>
.volview-embedded {
  width: 100%;
  height: 100%;
  position: relative;
  background: rgb(var(--v-theme-background));
}

.volview-container {
  width: 100%;
  height: 100%;
  display: flex;
  position: relative;
}

.volview-sidebar {
  width: 450px;
  height: 100%;
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgb(var(--v-theme-outline));
  z-index: 100;
  flex-shrink: 0;
}

.volview-sidebar--mobile {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 200;
  box-shadow: 0 8px 10px -5px rgba(0,0,0,.2), 0 16px 24px 2px rgba(0,0,0,.14), 0 6px 30px 5px rgba(0,0,0,.12);
}

.volview-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: margin-left 0.2s ease;
}

.volview-main--with-sidebar {
  margin-left: 0;
}

.volview-header {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgb(var(--v-theme-outline));
  flex-shrink: 0;
}

.volview-menu-btn {
  margin-right: 12px;
}

.volview-title {
  font-size: 1.25rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}

.volview-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.volview-overlay {
  position: absolute !important;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.dnd-prompt {
  background: rgba(0, 0, 0, 0.4);
  color: white;
  border-radius: 8px;
  box-shadow: 0px 0px 10px 5px rgba(0, 0, 0, 0.4);
  padding: 32px;
}

/* Aislar estilos de VolView para evitar conflictos */
.volview-embedded :deep(.v-application) {
  background: transparent !important;
}

.volview-embedded :deep(.v-main) {
  padding: 0 !important;
}

.volview-embedded :deep(.v-navigation-drawer) {
  position: relative !important;
  height: 100% !important;
}
</style>
