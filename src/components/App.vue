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
            tile
            icon
            class="toolbar-button"
            @click="aboutBoxDialog = !aboutBoxDialog"
          >
            <v-icon>mdi-help-circle-outline</v-icon>
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
              <tool-button
                size="40"
                icon="mdi-content-save-all"
                name="Save session"
                @click="saveDialog = true"
              />
              <div class="my-1 tool-separator" />
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
                      <v-radio
                        v-for="(value, key) in Layouts"
                        :key="key"
                        :label="value.name"
                        :value="key"
                      />
                    </v-radio-group>
                  </v-card-text>
                </v-card>
              </v-menu>
              <template v-if="hasData">
                <tool-strip />
              </template>
              <v-spacer />
              <v-badge
                overlap
                offset-x="20"
                offset-y="20"
                :content="messageCount"
                :color="messageBadgeColor"
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
              <layout-grid v-show="hasData" :layout="currentLayout" />
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
                      <div>Click to open local files.</div>
                      <div class="mt-8">
                        <v-icon size="64">mdi-arrow-down-bold</v-icon>
                      </div>
                      <div>Drag &amp; drop your DICOM files.</div>
                      <div class="vertical-offset-margin">
                        <v-icon size="64">mdi-cloud-off-outline</v-icon>
                      </div>
                      <div>Secure: Your data never leaves your machine.</div>
                    </v-card>
                  </v-row>
                </v-col>
              </v-row>
            </div>
          </div>
        </v-main>

        <v-dialog v-model="aboutBoxDialog" width="35%">
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

        <v-dialog v-model="saveDialog" width="30%">
          <save-session @close="saveDialog = false" />
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
  defineComponent,
  onBeforeUnmount,
  Ref,
  ref,
  watch,
} from '@vue/composition-api';
import { storeToRefs } from 'pinia';

import ResizableNavDrawer from './ResizableNavDrawer.vue';
import ToolButton from './ToolButton.vue';
import LayoutGrid from './LayoutGrid.vue';
import ModulePanel from './ModulePanel.vue';
import DragAndDrop from './DragAndDrop.vue';
import AboutBox from './AboutBox.vue';
import ToolStrip from './ToolStrip.vue';
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
import { useViewStore } from '../store/views';
import { MessageType, useMessageStore } from '../store/messages';
import { useRulerStore } from '../store/tools/rulers';
import { Layouts } from '../config';
import { isStateFile, loadState } from '../io/state-file';
import SaveSession from './SaveSession.vue';
import { useGlobalErrorHook } from '../composables/useGlobalErrorHook';
import { useWebGLWatchdog } from '../composables/useWebGLWatchdog';

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
    SaveSession,
  },

  setup() {
    const dataStore = useDatasetStore();
    const imageStore = useImageStore();
    const messageStore = useMessageStore();
    const viewStore = useViewStore();

    useGlobalErrorHook();
    useWebGLWatchdog();

    // --- layout --- //

    const layoutName: Ref<string> = ref('Quad View');
    const { layout: currentLayout } = storeToRefs(viewStore);

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

    watch(currentLayout, () => {
      if (
        currentLayout.value?.name &&
        currentLayout.value.name !== layoutName.value
      ) {
        layoutName.value = currentLayout.value.name;
      }
    });

    // --- loading tracker --- //

    const loadingCount = ref(0);
    const loadMsgID = ref('');

    watch(loadingCount, (count) => {
      if (count > 0 && loadMsgID.value === '') {
        loadMsgID.value = messageStore.addInfo('Loading files...', {
          persist: true,
        });
      } else if (count === 0 && loadMsgID.value !== '') {
        messageStore.clearOne(loadMsgID.value);
        loadMsgID.value = '';
      }
    });

    // --- file handling --- //
    async function openFiles(files: FileList | null) {
      if (!files) {
        return;
      }

      const loadFirstDataset = !dataStore.primarySelection;
      loadingCount.value += 1;

      let statuses: LoadResult[] = [];
      let stateFile = false;
      try {
        // For now only support restoring from a single state files.
        stateFile = files.length === 1 && (await isStateFile(files[0]));
        if (stateFile) {
          statuses = await loadState(files[0]);
        } else {
          statuses = await dataStore.loadFiles(Array.from(files));
        }
      } catch (error) {
        messageStore.addError('Failed to load files', error as Error);
      } finally {
        loadingCount.value -= 1;
      }

      const loaded = statuses.filter((s) => s.loaded) as (
        | FileLoadSuccess
        | DICOMLoadSuccess
      )[];
      const errored = statuses.filter((s) => !s.loaded) as (
        | FileLoadFailure
        | DICOMLoadFailure
      )[];

      if (
        loaded.length &&
        !stateFile &&
        (loadFirstDataset || loaded.length === 1)
      ) {
        const selection = convertSuccessResultToDataSelection(loaded[0]);
        if (selection) {
          dataStore.setPrimarySelection(selection);
        }
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

    // --- store initialization -- //

    const rulerStore = useRulerStore();
    rulerStore.initialize();

    onBeforeUnmount(() => rulerStore.uninitialize());

    // --- template vars --- //

    const hasData = computed(() => imageStore.idList.length > 0);
    const messageCount = computed(() => messageStore.importantMessages.length);
    const messageBadgeColor = computed(() => {
      if (
        messageStore.importantMessages.find(
          (msg) => msg.type === MessageType.Error
        )
      ) {
        return 'error';
      }
      if (
        messageStore.importantMessages.find(
          (msg) => msg.type === MessageType.Warning
        )
      ) {
        return 'warning';
      }
      return 'primary';
    });

    return {
      aboutBoxDialog: ref(false),
      messageDialog: ref(false),
      settingsDialog: ref(false),
      saveDialog: ref(false),
      messageCount,
      messageBadgeColor,
      layoutName,
      currentLayout,
      Layouts,
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

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
#left-nav {
  display: flex;
  flex-flow: column;
}

#tools-strip {
  border-left: 1px solid #212121;
  flex: 0 0 40px;
}

.toolbar-button {
  min-height: 100%; /* fill toolbar height */
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}

.vertical-offset-margin {
  margin-top: 128px;
}
</style>
