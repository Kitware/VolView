<template>
  <drag-and-drop enabled @drop="openFiles">
    <template v-slot="{ dragHover }">
      <v-app>
        <v-app-bar app dense clipped-left>
          <v-toolbar-title class="d-flex flex-row align-center mt-1">
            <vol-view-full-logo />
          </v-toolbar-title>
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
          <div class="fill-height d-flex flex-row flex-grow-1">
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
                  <div>
                    <tool-button
                      size="40"
                      icon="mdi-view-dashboard"
                      name="Layouts"
                      v-bind="attrs"
                      v-on="on"
                    />
                  </div>
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
                <tool-strip />
              </template>
              <v-spacer />
              <v-badge
                overlap
                offset-x="20"
                offset-y="20"
                :content="messageCount"
                :value="messageCount > 0"
              >
                <tool-button
                  size="40"
                  icon="mdi-bell-outline"
                  name="Notifications"
                  @click="messageDialog = true"
                />
              </v-badge>
              <tool-button
                size="40"
                icon="mdi-cog"
                name="Settings"
                @click="settingsDialog = true"
              />
            </div>
            <div class="d-flex flex-column flex-grow-1">
              <layout-grid v-show="hasData" :layout="layout" />
              <v-row
                v-show="!hasData"
                no-gutters
                align="center"
                class="clickable grey darken-3"
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
            </div>
          </div>
        </v-main>

        <v-dialog v-model="aboutBoxDialog" width="50%">
          <about-box />
        </v-dialog>

        <v-dialog
          v-model="messageDialog"
          width="75%"
          content-class="fill-height"
        >
          <message-center @close="messageDialog = false" />
        </v-dialog>

        <message-notifications @open-notifications="messageDialog = true" />

        <v-dialog v-model="settingsDialog" width="30%">
          <settings @close="settingsDialog = false" />
        </v-dialog>

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
  watch,
} from '@vue/composition-api';

import ResizableNavDrawer from './ResizableNavDrawer.vue';
import ToolButton from './ToolButton.vue';
import LayoutGrid from './LayoutGrid.vue';
import ModulePanel from './ModulePanel.vue';
import DragAndDrop from './DragAndDrop.vue';
import AboutBox from './AboutBox.vue';
import ToolStrip from './ToolStrip.vue';
import VtkTwoView from './VtkTwoView.vue';
import VtkThreeView from './VtkThreeView.vue';
import MessageCenter from './MessageCenter.vue';
import MessageNotifications from './MessageNotifications.vue';
import Settings from './Settings.vue';
import VolViewFullLogo from './icons/VolViewFullLogo.vue';
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
import {
  useViewStore,
  Layout,
  ViewKey,
  ViewConfig,
  LayoutDirection,
} from '../store/views';
import { LPSAxisDir } from '../utils/lps';
import { useMessageStore } from '../store/messages';
import { plural } from '../utils';

export const Views: Record<string, ViewConfig> = {
  Coronal: {
    objType: 'View2D',
    key: ViewKey.CoronalView,
    viewDirection: 'Left',
    viewUp: 'Superior',
  },
  Sagittal: {
    objType: 'View2D',
    key: ViewKey.SagittalView,
    viewDirection: 'Anterior',
    viewUp: 'Superior',
  },
  Axial: {
    objType: 'View2D',
    key: ViewKey.AxialView,
    viewDirection: 'Inferior',
    viewUp: 'Anterior',
  },
  Three: {
    objType: 'View3D',
    key: ViewKey.ThreeDView,
    viewDirection: 'Inferior',
    viewUp: 'Anterior',
  },
};

export const Layouts: Record<string, Layout> = {
  AxialPrimary: {
    objType: 'Layout',
    direction: LayoutDirection.V,
    items: [
      Views.Axial,
      {
        objType: 'Layout',
        direction: LayoutDirection.H,
        items: [Views.Coronal, Views.Sagittal, Views.Three],
      },
    ],
  },
  QuadView: {
    objType: 'Layout',
    direction: LayoutDirection.H,
    items: [
      {
        objType: 'Layout',
        direction: LayoutDirection.V,
        items: [Views.Coronal, Views.Three],
      },
      {
        objType: 'Layout',
        direction: LayoutDirection.V,
        items: [Views.Sagittal, Views.Axial],
      },
    ],
  },
};

interface LayoutGridItemProps {
  key: ViewKey;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

interface LayoutGridItem {
  comp: typeof VtkTwoView | typeof VtkThreeView;
  props: LayoutGridItemProps;
}

type LayoutGridArrayItem =
  | LayoutDirection
  | LayoutGridItem
  | Array<LayoutGridArrayItem>;

type LayoutGridArray = Array<LayoutGridArrayItem>;

// Convert Layout to format LayoutGrid expects
const toLayoutGridArray = (layout: Layout): LayoutGridArrayItem => {
  if (layout.objType === 'Layout') {
    const layoutArray: LayoutGridArray = [layout.direction];
    layout.items.forEach((item) => {
      layoutArray.push(toLayoutGridArray(item));
    });

    return layoutArray;
  }
  if (layout.objType === 'View2D') {
    return {
      comp: VtkTwoView,
      props: {
        key: layout.key,
        viewDirection: layout.viewDirection,
        viewUp: layout.viewUp,
      },
    };
  }
  if (layout.objType === 'View3D') {
    return {
      comp: VtkThreeView,
      props: {
        key: layout.key,
        viewDirection: layout.viewDirection,
        viewUp: layout.viewUp,
      },
    };
  }
  // Needed to keep compiler happy!
  throw new Error('Unrecognized objType');
};

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
    MessageCenter,
    MessageNotifications,
    VolViewFullLogo,
    Settings,
  },

  setup() {
    const proxyManager = useProxyManager();
    const dataStore = useDatasetStore();
    const imageStore = useImageStore();
    const messageStore = useMessageStore();
    const viewStore = useViewStore();

    // --- auto-animate views whenever a proxy is modified --- //

    onProxyManagerEvent(ProxyManagerEvent.ProxyModified, () => {
      proxyManager?.autoAnimateViews();
    });

    // --- layout --- //

    const layoutName: Ref<'QuadView' | 'AxialPrimary'> = ref('QuadView');

    const layoutGrid: ComputedRef<any> = computed(() => {
      const { layout } = viewStore;
      return toLayoutGridArray(layout);
    });

    function relayoutAxial() {
      layoutName.value = 'AxialPrimary';
    }

    function relayoutQuad() {
      layoutName.value = 'QuadView';
    }

    watch(
      layoutName,
      () => {
        const layout = Layouts[layoutName.value] || [];
        viewStore.setLayout(layout);
      },
      {
        immediate: true,
      }
    );

    // --- file handling --- //

    async function openFiles(files: FileList | null) {
      if (!files) {
        return;
      }

      const nFiles = files.length;

      const loadFirstDataset = !dataStore.primarySelection;
      const msgID = messageStore.addInfo(
        `Loading ${nFiles} ${plural(nFiles, 'file')}...`
      );

      let statuses: LoadResult[] = [];

      try {
        statuses = await dataStore.loadFiles(Array.from(files));
      } catch (error) {
        messageStore.addError('Failed to load files', error as Error);
      } finally {
        messageStore.clearOne(msgID);
      }

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

      const failedFilenames = errored.map((result) => {
        if (result.type === 'file') {
          return result.filename;
        }
        return 'DICOM files';
      });
      const failedFileMessage = `These files failed to load:\n${failedFilenames.join(
        '\n'
      )}`;

      if (loaded.length && !errored.length) {
        messageStore.addSuccess('Loaded files');
      }
      if (loaded.length && errored.length) {
        messageStore.addWarning('Some files failed to load', failedFileMessage);
      }
      if (!loaded.length && errored.length) {
        messageStore.addError('Files failed to load', failedFileMessage);
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
    const messageCount = computed(() => messageStore.importantMessages.length);

    return {
      aboutBoxDialog: ref(false),
      messageDialog: ref(false),
      settingsDialog: ref(false),
      messageCount,
      layout: layoutGrid,
      layoutName,
      relayoutAxial,
      relayoutQuad,
      userPromptFiles,
      openFiles,
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
