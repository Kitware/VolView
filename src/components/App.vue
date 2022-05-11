<template>
  <drag-and-drop enabled @drop="openFiles">
    <template v-slot="{ dragHover }">
      <v-app>
        <v-app-bar app dense clipped-left>
          <v-toolbar-title>VolView</v-toolbar-title>
          <v-spacer />
          <v-btn
            text
            tile
            class="toolbar-button"
            @click="aboutBoxDialog = !aboutBoxDialog"
          >
            <v-icon left size="32">$kitwareMark</v-icon>
            About
          </v-btn>
        </v-app-bar>
        <resizable-nav-drawer
          id="left-nav"
          app
          permanent
          clipped
          :min-width="450"
          :max-width="550"
          :width="450"
          :handle-size="4"
        >
          <module-panel />
        </resizable-nav-drawer>
        <v-main id="content-wrapper">
          <div class="height-100 d-flex flex-row flex-grow-1 grey darken-3">
            <div
              id="tools-strip"
              class="grey darken-4 d-flex flex-column align-center"
            >
              <tool-button
                size="40"
                icon="mdi-folder-open"
                name="Open files"
                @click="userPromptFiles"
              />
              <v-menu offset-x>
                <template v-slot:activator="{ on, attrs }">
                  <!-- hack to get menu to show up -->
                  &nbsp;
                  <tool-button
                    size="40"
                    icon="mdi-view-dashboard"
                    name="Layouts"
                    v-bind="attrs"
                    v-on="on"
                  />
                </template>
                <v-card>
                  <v-card-text>
                    <v-radio-group
                      v-model="layoutName"
                      class="mt-0"
                      hide-details
                    >
                      <v-radio label="Axial Primary" value="AxialPrimary" />
                      <v-radio label="Quad View" value="QuadView" />
                    </v-radio-group>
                  </v-card-text>
                </v-card>
              </v-menu>
              <div class="mt-2 mb-1 tool-separator" />
              <template v-if="hasData">
                <tool-strip @focus-module="focusModule" />
              </template>
            </div>
            <div class="d-flex flex-column flex-grow-1">
              <template v-if="hasData">
                <layout-grid :layout="layout" />
              </template>
              <template v-else>
                <v-row
                  no-gutters
                  align="center"
                  class="clickable"
                  @click="userPromptFiles"
                >
                  <v-col>
                    <v-row justify="center">
                      <v-card
                        flat
                        dark
                        color="transparent"
                        class="text-center headline"
                      >
                        <div>
                          <v-icon size="64">mdi-folder-open</v-icon>
                        </div>
                        <div>Click anywhere here to open files</div>
                        <div class="mt-8">
                          <v-icon size="64">mdi-arrow-down-bold</v-icon>
                        </div>
                        <div>Drop your files anywhere here to open</div>
                      </v-card>
                    </v-row>
                  </v-col>
                </v-row>
              </template>
            </div>
          </div>
        </v-main>

        <v-dialog v-model="errorDialog" width="50%">
          <v-card>
            <v-card-title>Application Errors</v-card-title>
            <v-card-text>
              <v-container>
                <v-row
                  v-for="(errorInfo, i) in allErrors"
                  :key="i"
                  no-gutters
                  class="align-center mt-2"
                >
                  <v-col
                    cols="6"
                    class="text-ellipsis subtitle-1 black--text"
                    :title="errorInfo.name"
                  >
                    Error: {{ errorInfo.name }}
                  </v-col>
                  <v-col>
                    <span class="ml-2">
                      {{ errorInfo.error.message || 'Unknown error' }}
                    </span>
                  </v-col>
                </v-row>
              </v-container>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn color="primary" @click="clearAndCloseErrors">
                Clear
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-dialog>

        <v-dialog v-model="aboutBoxDialog" width="50%">
          <about-box />
        </v-dialog>

        <notifications position="bottom left" :duration="4000" width="350px">
          <template slot="body" slot-scope="{ item, close }">
            <div
              class="vue-notification-template general-notifications"
              :class="`notify-${item.type}`"
              @click="close"
            >
              <div class="notification-content d-flex flex-row align-center">
                <span class="subtitle-1 flex-grow-1">{{ item.text }}</span>
                <div class="actions-stack d-flex flex-column align-right">
                  <template v-if="item.data && item.data.actions">
                    <v-btn
                      v-for="(action, i) in item.data.actions"
                      :key="i"
                      text
                      color="white"
                      @click.stop="
                        close();
                        action.onclick();
                      "
                    >
                      {{ action.text }}
                    </v-btn>
                  </template>
                  <template v-else>
                    <v-btn
                      v-if="item.type !== 'loading'"
                      text
                      color="white"
                      @click.stop="close"
                    >
                      Close
                    </v-btn>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </notifications>
        <v-overlay
          :value="dragHover"
          color="#fff"
          z-index="100"
          class="text-center"
        >
          <v-icon color="black" size="4.75rem">mdi-download</v-icon>
          <div class="text-h2 font-weight-bold black--text">
            Drop your files to open
          </div>
        </v-overlay>
      </v-app>
    </template>
  </drag-and-drop>
</template>

<script lang="ts">
import {
  computed,
  ComputedRef,
  defineComponent,
  Ref,
  ref,
} from '@vue/composition-api';

import ResizableNavDrawer from './ResizableNavDrawer.vue';
import ToolButton from './ToolButton.vue';
import LayoutGrid from './LayoutGrid.vue';
import PatientBrowser from '../componentsX/PatientBrowser.vue';
import ModulePanel from './ModulePanel.vue';
// import Annotations from './Annotations.vue';
import VolumeRendering from '../componentsX/VolumeRendering.vue';
// import MeasurementsModule from './MeasurementsModule.vue';
// import ModelBrowser from './ModelBrowser.vue';
import DragAndDrop from './DragAndDrop.vue';
import AboutBox from './AboutBox.vue';
// import AiModule from './AiModule.vue';
import ToolStrip from './ToolStrip.vue';
import SampleData from './SampleData.vue';
import VtkTwoView from '../componentsX/VtkTwoView.vue';
import VtkThreeView from '../componentsX/VtkThreeView.vue';
import {
  useDatasetStore,
  convertSuccessResultToDataSelection,
  LoadResult,
  FileLoadSuccess,
  DICOMLoadSuccess,
  FileLoadFailure,
  DICOMLoadFailure,
} from '../store/datasets';
import { useImageStore } from '../store/datasets-images';
import {
  onProxyManagerEvent,
  ProxyManagerEvent,
} from '../composables/onProxyManagerEvent';
import { useProxyManager } from '../composables/proxyManager';

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
  /*
  {
    name: 'Annotations',
    icon: 'pencil',
    component: Annotations,
  },
  {
    name: 'Models',
    icon: 'hexagon-multiple',
    component: ModelBrowser,
  },
  */
  {
    name: 'Volume Rendering',
    icon: 'cube',
    component: VolumeRendering,
  },
  /*
  {
    name: 'Measurements',
    icon: 'pencil-ruler',
    component: MeasurementsModule,
  },
  {
    name: 'AI',
    icon: 'robot-outline',
    component: AiModule,
  },
  */
];

export const Views = {
  Coronal: {
    comp: VtkTwoView,
    props: {
      key: 'CoronalView',
      viewDirection: 'Left',
      viewUp: 'Superior',
    },
  },
  Sagittal: {
    comp: VtkTwoView,
    props: {
      key: 'SagittalView',
      viewDirection: 'Anterior',
      viewUp: 'Superior',
    },
  },
  Axial: {
    comp: VtkTwoView,
    props: {
      key: 'AxialView',
      viewDirection: 'Inferior',
      viewUp: 'Anterior',
    },
  },
  Three: {
    comp: VtkThreeView,
    props: {
      key: '3DView',
      viewDirection: 'Inferior',
      viewUp: 'Anterior',
    },
  },
};

export const Layouts = {
  AxialPrimary: [
    'V',
    Views.Axial,
    ['H', Views.Coronal, Views.Sagittal, Views.Three],
  ],
  QuadView: [
    'H',
    ['V', Views.Coronal, Views.Three],
    ['V', Views.Sagittal, Views.Axial],
  ],
};

interface ErrorInfo {
  name: string;
  error: Error;
}

export default defineComponent({
  name: 'App',

  components: {
    ResizableNavDrawer,
    ToolButton,
    LayoutGrid,
    DragAndDrop,
    AboutBox,
    ToolStrip,
    ModulePanel,
  },

  setup() {
    const proxyManager = useProxyManager();
    const dataStore = useDatasetStore();
    const imageStore = useImageStore();

    // error state
    const fileLoadingErrors: Ref<LoadResult[]> = ref([]);
    const otherErrors: Ref<ErrorInfo[]> = ref([]);

    // dialogs
    const aboutBoxDialog = ref(false);
    const errorDialog = ref(false);

    function clearAndCloseErrors() {
      errorDialog.value = false;
      fileLoadingErrors.value = [];
      otherErrors.value = [];
    }

    // --- auto-animate views whenever a proxy is modified --- //

    onProxyManagerEvent(ProxyManagerEvent.ProxyModified, () => {
      proxyManager?.autoAnimateViews();
    });

    // --- modules --- //

    const selectedModule = ref(Modules[0]);

    function focusModule(modName: string) {
      const mod = Modules.find((m) => m.name === modName);
      if (mod) {
        selectedModule.value = mod;
      }
    }

    // --- layout --- //

    const layoutName: Ref<'QuadView' | 'AxialPrimary'> = ref('QuadView');

    const layout: ComputedRef<any> = computed(
      () => Layouts[layoutName.value] || []
    );

    function relayoutAxial() {
      layoutName.value = 'AxialPrimary';
    }

    function relayoutQuad() {
      layoutName.value = 'QuadView';
    }

    // --- file handling --- //

    async function openFiles(files: FileList | null) {
      if (!files) {
        return;
      }

      const loadFirstDataset = !dataStore.primarySelection;

      try {
        const statuses = await dataStore.loadFiles(Array.from(files));

        const loaded = statuses.filter((s) => s.loaded) as (
          | FileLoadSuccess
          | DICOMLoadSuccess
        )[];
        const errored = statuses.filter((s) => !s.loaded) as (
          | FileLoadFailure
          | DICOMLoadFailure
        )[];

        if (loaded.length && (loadFirstDataset || loaded.length === 1)) {
          const selection = convertSuccessResultToDataSelection(loaded[0]);
          dataStore.setPrimarySelection(selection);
        }

        if (errored.length) {
          fileLoadingErrors.value = errored;
        } else {
          //
        }
      } catch (error) {
        otherErrors.value.push({
          name: 'openFiles error',
          error: error as Error,
        });
      } finally {
        // TODO only close if there are no pending files
      }
    }

    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', () => openFiles(fileEl.files));

    function userPromptFiles() {
      fileEl.value = '';
      fileEl.click();
    }

    // --- template vars --- //

    const hasData = computed(() => imageStore.idList.length > 0);
    const allErrors = computed(() => [
      ...fileLoadingErrors.value,
      ...otherErrors.value,
    ]);

    return {
      selectedModule,
      aboutBoxDialog,
      errorDialog,
      layout,
      layoutName,
      relayoutAxial,
      relayoutQuad,
      allErrors,
      clearAndCloseErrors,
      Modules,
      userPromptFiles,
      openFiles,
      focusModule,
      hasData,
    };
  },
});
</script>

<style>
#content-wrapper {
  /* disable v-content transition when we resize our app drawer */
  transition: initial;
}

#content-wrapper > .v-content__wrap {
  display: flex;
}

#module-switcher .v-input__prepend-inner {
  /* better icon alignment */
  margin-top: 15px;
}

.alert > .v-snack__wrapper {
  /* transition background color */
  transition: background-color 0.25s;
}

.general-notifications {
  padding: 10px;
  margin: 0 20px 20px;
  color: #fff;
  background: #44a4fc;
  border-left: 5px solid #187fe7;
  user-select: none;
}

.general-notifications.notify-success {
  background: #4caf50;
  border-left-color: #42a85f;
}

.general-notifications.notify-warn {
  background: #ffb648;
  border-left-color: #f48a06;
}

.general-notifications.notify-error {
  background: #e54d42;
  border-left-color: #b82e24;
}
</style>

<style scoped>
#left-nav {
  display: flex;
  flex-flow: column;
}

#tools-strip {
  border-left: 1px solid #212121;
  flex: 0 0 40px;
}

.view-box {
  box-sizing: border-box;
}

.clickable {
  cursor: pointer;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}

.toolbar-button {
  min-height: 100%; /* fill toolbar height */
}
</style>
