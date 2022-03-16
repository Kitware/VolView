<template>
  <drag-and-drop enabled @drop="openFiles">
    <template v-slot="{ dragHover }">
      <v-app>
        <v-app-bar app dense clipped-left>
          <v-toolbar-title>ParaView Medical</v-toolbar-title>
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
          :min-width="250"
          :max-width="450"
          :width="350"
          :handle-size="4"
        >
          <div class="height-100 d-flex flex-column">
            <div id="left-pane-outer">
              <div id="left-pane">
                <div id="module-switcher" class="mt-1 mb-2">
                  <v-select
                    v-model="selectedModule"
                    outlined
                    single-line
                    hide-details
                    :prepend-inner-icon="`mdi-${selectedModule.icon}`"
                    :items="Modules"
                    item-text="name"
                    return-object
                    class="no-select"
                  >
                    <template v-slot:item="{ item }">
                      <v-icon v-if="item.icon" class="mr-1">
                        mdi-{{ item.icon }}
                      </v-icon>
                      {{ item.name }}
                    </template>
                  </v-select>
                </div>

                <!-- Preserve component state of modules when switching between modules -->
                <div id="module-container">
                  <template v-for="mod in Modules">
                    <component
                      :key="mod.name"
                      v-show="selectedModule === mod"
                      :is="mod.component"
                    />
                  </template>
                </div>
              </div>
            </div>
          </div>
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

        <v-dialog v-model="errors.dialog" width="50%">
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

<script>
import { mapStores } from 'pinia';

import ResizableNavDrawer from './ResizableNavDrawer.vue';
import ToolButton from './ToolButton.vue';
import LayoutGrid from './LayoutGrid.vue';
import PatientBrowser from '../componentsX/PatientBrowser.vue';
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
import { syncProxyManagerWithStores } from '../vtk/proxyStoreSync';
import {
  makeImageSelection,
  makeDICOMSelection,
  useDatasetStore,
} from '../storex/datasets';
import { useImageStore } from '../storex/datasets-images';

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

export default {
  name: 'App',

  components: {
    ResizableNavDrawer,
    ToolButton,
    LayoutGrid,
    DragAndDrop,
    AboutBox,
    ToolStrip,
  },

  inject: ['widgetProvider'],

  data: () => ({
    selectedModule: Modules[0],
    aboutBoxDialog: false,
    errors: {
      dialog: false,
      fileLoading: [],
      actionErrors: [],
    },
    layoutName: 'QuadView',
    Modules,
  }),

  computed: {
    ...mapStores(useDatasetStore, useImageStore),
    hasData() {
      return this.imagesStore.idList.length > 0;
    },
    allErrors() {
      return [].concat(this.errors.fileLoading, this.errors.actionErrors);
    },
    layout() {
      return Layouts[this.layoutName] || [];
    },
  },

  watch: {
    fileErrorDialog(state) {
      if (!state) {
        this.fileLoadErrors = [];
      }
    },
  },

  proxyManagerHooks: {
    onProxyModified() {
      // auto-sync views
      this.$proxyManager.autoAnimateViews();
    },
  },

  created() {
    syncProxyManagerWithStores(this.$proxyManager);
  },

  mounted() {
    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', this.onFileSelect);
    this.fileEl = fileEl;
  },

  methods: {
    userPromptFiles() {
      this.fileEl.value = null;
      this.fileEl.click();
    },

    async onFileSelect(evt) {
      return this.openFiles(evt.target.files);
    },

    async openFiles(files) {
      this.$notify({
        id: 'loading',
        type: 'loading',
        duration: -1,
        text: 'Loading...',
      });

      const actions = [
        {
          text: 'details',
          onclick: () => {
            this.errors.dialog = true;
          },
        },
        {
          text: 'close',
          onclick: this.clearAndCloseErrors,
        },
      ];

      const loadFirstDataset = !this.datasetsStore.primarySelection;

      try {
        const statuses = await this.datasetsStore.loadFiles(Array.from(files));

        const loaded = statuses.filter((s) => s.loaded);
        const errored = statuses.filter((s) => !s.loaded);

        if (loaded.length && (loadFirstDataset || loaded.length === 1)) {
          const dataStatus = loaded[0];
          const { dataType, dataID } = dataStatus;
          if (dataType === 'image') {
            this.datasetsStore.setPrimarySelection(makeImageSelection(dataID));
          } else if (dataType === 'dicom') {
            this.datasetsStore.setPrimarySelection(makeDICOMSelection(dataID));
          }
        }

        if (errored.length) {
          this.errors.fileLoading = errored;
          this.$notify({
            type: 'error',
            duration: -1,
            text: 'Some files failed to load',
            data: { actions },
          });
        } else {
          this.$notify({ type: 'success', text: 'Files loaded' });
        }
      } catch (error) {
        this.errors.actionErrors.push({
          name: 'Unknown error',
          error,
        });
        this.$notify({
          type: 'error',
          duration: -1,
          text: 'An unknown file loading error occurred',
          data: { actions },
        });
      } finally {
        // TODO only close if there are no pending files
        this.$notify.close('loading');
      }
    },

    clearAndCloseErrors() {
      this.errors.dialog = false;
      this.errors.fileLoading = [];
      this.errors.actionErrors = [];
    },

    relayoutAxial() {
      this.layout = Layouts.AxialPrimary;
    },

    relayoutQuad() {
      this.layout = Layouts.QuadView;
    },

    focusModule(modName) {
      const mod = Modules.find((m) => m.name === modName);
      if (mod) {
        this.selectedModule = mod;
      }
    },
  },
};
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

#left-pane {
  display: flex;
  flex-flow: column;
  min-width: 225px;
  flex: 1;
  overflow: auto;
}

#left-pane-outer {
  display: flex;
  overflow: auto;
  flex: 2;
  width: 100%;
  flex-flow: column;
  /* left-nav handle size is 4px */
  padding: 0 4px 2px 2px;
}

#module-switcher {
  flex: 0 2;
}

#module-container {
  position: relative;
  flex: 2;
  overflow: auto;
}

.toolbar-button {
  min-height: 100%; /* fill toolbar height */
}
</style>
