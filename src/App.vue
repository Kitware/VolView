<template>
  <v-app>
    <resizable-nav-drawer
      id="left-nav"
      app
      permanent
      :min-width="250"
      :max-width="450"
      :width="350"
      :handle-size="4"
      @resize="$eventBus.$emit('resize')"
    >
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
                <v-icon v-if="item.icon" class="mr-1">mdi-{{ item.icon }}</v-icon>
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
    </resizable-nav-drawer>

    <v-content id="content-wrapper">
      <div class="d-flex flex-row flex-grow-1 grey darken-3">
        <div id="tools-strip" class="grey darken-4 d-flex flex-column align-center">
          <tool-button size="40" icon="mdi-folder-open" name="Open files" buttonClass="tool-btn" />
          <div class="mt-2 mb-1 tool-separator" />
          <v-item-group v-model="selectedTool">
            <template v-for="(tool,i) in Tools">
              <v-item
                :key="i"
                v-slot:default="{ active, toggle }"
              >
                <tool-button
                  size="40"
                  :icon="`mdi-${tool.icon}`"
                  :name="tool.name"
                  :buttonClass="[
                    'tool-btn',
                    active ? 'tool-btn-selected' : '',
                  ]"
                  @click="toggle"
                />
              </v-item>
            </template>
          </v-item-group>
        </div>
        <div class="d-flex flex-column flex-grow-1">
          <template v-if="hasSelectedBaseImage">
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
                  <v-card flat dark color="transparent" class="text-center headline">
                    <div>
                      <v-icon size="64">mdi-folder-open</v-icon>
                    </div>
                    <div>
                      Click anywhere here to open files
                    </div>
                    <div class="mt-8">
                      <v-icon size="64">mdi-arrow-down-bold</v-icon>
                    </div>
                    <div>
                      Drop your files anywhere here to open
                    </div>
                  </v-card>
                </v-row>
              </v-col>
            </v-row>
          </template>
        </div>
      </div>
    </v-content>

    <v-dialog
      v-model="errors.dialog"
      width="50%"
    >
      <v-card>
        <v-card-title>Application Errors</v-card-title>
        <v-card-text>
          <v-container>
            <v-row
              v-for="(errorInfo,i) in errors.fileLoading"
              :key="i"
              no-gutters
              class="align-center mt-2"
            >
              <v-col
                cols="6"
                class="text-ellipsis subtitle-1 black--text"
                :title="errorInfo.name"
              >
                Load error: {{ errorInfo.name }}
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
          <v-btn
            color="primary"
            @click="clearAndCloseErrors"
          >
            Clear
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <notifications
      position="bottom left"
      :duration="4000"
      width="350px"
    >
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
                  v-for="(action,i) in item.data.actions"
                  :key="i"
                  text
                  color="white"
                  @click.stop="close(); action.onclick()"
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

  </v-app>
</template>

<script>
import { mapActions, mapState } from 'vuex';

import { createFourUpViews } from '@/src/vtk/proxyUtils';
import { NO_SELECTION } from '@/src/store/datasets';

import ResizableNavDrawer from './components/ResizableNavDrawer.vue';
import ToolButton from './components/ToolButton.vue';
import VtkTwoView from './components/VtkTwoView.vue';
import LayoutGrid from './components/LayoutGrid.vue';
import PatientBrowser from './components/PatientBrowser.vue';
// import MeasurementsModule from './components/MeasurementsModule.vue';

export const Modules = [
  {
    name: 'Patients',
    icon: 'account',
    component: PatientBrowser,
  },
  {
    name: 'Measurements',
    icon: 'pencil-ruler',
    component: null,
  },
];

export const Tools = [
  {
    name: 'Paint',
    icon: 'brush',
  },
  {
    name: 'Box',
    icon: 'selection',
  },
  {
    name: 'Ellipse',
    icon: 'selection-ellipse',
  },
  {
    name: 'Crop',
    icon: 'crop',
  },
];

export default {
  name: 'App',

  components: {
    ResizableNavDrawer,
    ToolButton,
    LayoutGrid,
  },

  data: () => ({
    selectedTool: null,
    selectedModule: Modules[0],

    errors: {
      dialog: false,
      fileLoading: [],
    },

    // initial four-up layout
    layout: [
      'H',
      [
        'V',
        {
          comp: VtkTwoView,
          props: {
            viewType: 'ViewX',
            viewName: 'X:1',
            axis: 0,
            orientation: 1,
            viewUp: [0, 0, 1],
          },
        },
        {
          comp: VtkTwoView,
          props: {
            viewType: 'ViewY',
            viewName: 'Y:1',
            axis: 1,
            orientation: -1,
            viewUp: [0, 0, 1],
          },
        },
      ],
      [
        'V',
        {
          comp: VtkTwoView,
          props: {
            viewType: 'ViewZ',
            viewName: 'Z:1',
            axis: 2,
            orientation: -1,
            viewUp: [0, -1, 0],
          },
        },
        {
          comp: VtkTwoView,
          props: {
            viewType: 'ViewY',
            viewName: 'Y:2',
            axis: 1,
            orientation: -1,
            viewUp: [0, 0, 1],
          },
        },
      ],
    ],

    Tools,
    Modules,
  }),

  computed: {
    ...mapState('datasets', ['selectedBaseImage']),
    hasSelectedBaseImage() {
      return this.selectedBaseImage !== NO_SELECTION;
    },
  },

  watch: {
    fileErrorDialog(state) {
      if (!state) {
        this.fileLoadErrors = [];
      }
    },
  },

  mounted() {
    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', this.onFileSelect);
    this.fileEl = fileEl;

    createFourUpViews(this.$proxyManager);
  },

  methods: {
    userPromptFiles() {
      this.fileEl.value = null;
      this.fileEl.click();
    },

    async onFileSelect(evt) {
      const { files } = evt.target;

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

      try {
        const errors = await this.loadFiles(Array.from(files));
        if (errors.length) {
          this.errors.fileLoading = errors;
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
        this.errors.actionErrors.push(error);
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

    ...mapActions('datasets', ['loadFiles']),
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
  background: #44A4FC;
  border-left: 5px solid #187FE7;
  user-select: none;
}

.general-notifications.notify-success {
  background: #4caf50;
  border-left-color: #42A85F;
}

.general-notifications.notify-warn {
  background: #ffb648;
  border-left-color: #f48a06;
}

.general-notifications.notify-error {
  background: #E54D42;
  border-left-color: #B82E24;
}
</style>

<style scoped>
#left-nav {
  padding: 2px;
  /* left-nav handle size is 4px */
  padding-right: 4px;
}

#tools-strip {
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

.tool-btn {
  margin-top: 4px;
}

.tool-btn-selected {
  background-color: rgba(128, 128, 255, 0.7);
}

#left-pane {
  display: flex;
  flex-flow: column;
  min-width: 225px;
  flex: 1;
}

#left-pane-outer {
  display: flex;
  overflow: auto;
  height: 100%;
  width: 100%;
}

#module-switcher {
  flex: 0 2;
}

#module-container {
  position: relative;
  flex: 2;
  overflow: auto;
}
</style>
