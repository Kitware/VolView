<template>
  <drag-and-drop enabled @drop-files="openFiles" id="app-container">
    <template v-slot="{ dragHover }">
      <v-app>
        <v-app-bar app clipped-left :height="48">
          <v-btn
            v-if="mobile"
            icon="mdi-menu"
            @click="leftSideBar = !leftSideBar"
          />
          <v-toolbar-title class="d-flex flex-row align-center mt-3">
            <vol-view-logo v-if="mobile" />
            <vol-view-full-logo v-else />
          </v-toolbar-title>
          <v-btn
            variant="text"
            icon="mdi-help-circle-outline"
            :rounded="0"
            class="toolbar-button"
            @click="aboutBoxDialog = !aboutBoxDialog"
          />
        </v-app-bar>
        <v-navigation-drawer
          v-model="leftSideBar"
          app
          clipped
          touchless
          width="450"
          id="left-nav"
        >
          <module-panel @close="leftSideBar = false" />
        </v-navigation-drawer>
        <v-main id="content-main">
          <div class="fill-height d-flex flex-row flex-grow-1">
            <div
              id="tools-strip"
              class="bg-grey-darken-4 d-flex flex-column align-center"
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
                :loading="saveHappening"
                @click="handleSave"
              />
              <div class="my-1 tool-separator" />
              <v-menu location="right">
                <template v-slot:activator="{ props }">
                  <div>
                    <tool-button
                      v-bind="props"
                      size="40"
                      icon="mdi-view-dashboard"
                      name="Layouts"
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
                offset-x="10"
                offset-y="10"
                :content="messageCount"
                :color="messageBadgeColor"
                :model-value="messageCount > 0"
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
                class="clickable bg-grey-darken-3"
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

        <v-dialog v-model="aboutBoxDialog" :width="mobile ? '100%' : '80%'">
          <about-box @close="aboutBoxDialog = false" />
        </v-dialog>

        <v-dialog
          v-model="messageDialog"
          :width="mobile ? '100%' : '75%'"
          content-class="fill-height"
        >
          <message-center @close="messageDialog = false" />
        </v-dialog>

        <message-notifications @open-notifications="messageDialog = true" />

        <v-dialog v-model="settingsDialog" :width="mobile ? '100%' : '50%'">
          <settings @close="settingsDialog = false" v-if="settingsDialog" />
        </v-dialog>

        <v-dialog v-model="saveDialog" :width="mobile ? '100%' : '30%'">
          <save-session @close="saveDialog = false" />
        </v-dialog>
      </v-app>
      <persistent-overlay
        :disabled="!dragHover"
        color="#000"
        :opacity="0.3"
        :z-index="2000"
        class="text-center"
      >
        <div class="d-flex flex-column align-center justify-center h-100">
          <div class="dnd-prompt">
            <v-icon size="4.75rem">mdi-download</v-icon>
            <div class="text-h2 font-weight-bold">Drop your files to open</div>
          </div>
        </div>
      </persistent-overlay>
    </template>
  </drag-and-drop>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onMounted,
  Ref,
  ref,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { UrlParams } from '@vueuse/core';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { URL } from 'whatwg-url';
import { useDisplay } from 'vuetify';

import { basename } from '@/src/utils/path';
import { useDatasetStore } from '@/src/store/datasets';
import { logError } from '@/src/utils/loggers';
import {
  importDataSources,
  ImportDataSourcesResult,
  convertSuccessResultToDataSelection,
} from '@/src/io/import/importDataSources';
import ToolButton from './ToolButton.vue';
import LayoutGrid from './LayoutGrid.vue';
import ModulePanel from './ModulePanel.vue';
import DragAndDrop from './DragAndDrop.vue';
import AboutBox from './AboutBox.vue';
import ToolStrip from './ToolStrip.vue';
import MessageCenter from './MessageCenter.vue';
import MessageNotifications from './MessageNotifications.vue';
import Settings from './Settings.vue';
import PersistentOverlay from './PersistentOverlay.vue';
import VolViewFullLogo from './icons/VolViewFullLogo.vue';
import VolViewLogo from './icons/VolViewLogo.vue';
import {
  DataSource,
  fileToDataSource,
  getDataSourceName,
  uriToDataSource,
} from '../io/import/dataSource';
import { useImageStore } from '../store/datasets-images';
import { useViewStore } from '../store/views';
import { MessageType, useMessageStore } from '../store/messages';
import { Layouts } from '../config';
import { serialize } from '../io/state-file';
import SaveSession from './SaveSession.vue';
import { useGlobalErrorHook } from '../composables/useGlobalErrorHook';
import { useWebGLWatchdog } from '../composables/useWebGLWatchdog';
import { useAppLoadingNotifications } from '../composables/useAppLoadingNotifications';
import { partition, wrapInArray } from '../utils';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts';

async function loadFiles(
  sources: DataSource[],
  setError: (err: Error) => void
) {
  const dataStore = useDatasetStore();

  let results: ImportDataSourcesResult[];
  try {
    results = await importDataSources(sources);
  } catch (error) {
    setError(error as Error);
    return;
  }

  const [succeeded, errored] = partition((result) => result.ok, results);

  if (!dataStore.primarySelection && succeeded.length) {
    const selection = convertSuccessResultToDataSelection(succeeded[0]);
    if (selection) {
      dataStore.setPrimarySelection(selection);
    }
  }

  if (errored.length) {
    const errorMessages = errored.map((errResult) => {
      // pick first error
      const [firstError] = errResult.errors;
      // pick innermost dataset that errored
      const name = getDataSourceName(firstError.inputDataStackTrace[0]);
      // log error for debugging
      logError(firstError.cause);
      return `- ${name}: ${firstError.message}`;
    });
    const failedError = new Error(
      `These files failed to load:\n${errorMessages.join('\n')}`
    );

    setError(failedError);
  }
}

async function loadRemoteFilesFromURLParams(
  params: UrlParams,
  setError: (err: Error) => void
) {
  const urls = wrapInArray(params.urls);
  const names = wrapInArray(params.names ?? []); // optional names should resolve to [] if params.names === undefined
  const sources = urls.map((url, idx) =>
    uriToDataSource(
      url,
      names[idx] || basename(new URL(url, window.location.href).pathname) || url
    )
  );

  await loadFiles(sources, setError);
}

export default defineComponent({
  name: 'App',

  components: {
    ToolButton,
    LayoutGrid,
    DragAndDrop,
    AboutBox,
    ToolStrip,
    ModulePanel,
    MessageCenter,
    MessageNotifications,
    VolViewFullLogo,
    VolViewLogo,
    Settings,
    SaveSession,
    PersistentOverlay,
  },

  setup() {
    const imageStore = useImageStore();
    const messageStore = useMessageStore();
    const viewStore = useViewStore();

    useGlobalErrorHook();
    useWebGLWatchdog();
    useKeyboardShortcuts();

    const { runAsLoading } = useAppLoadingNotifications();

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

    // --- file handling --- //

    async function openFiles(files: FileList | null) {
      if (!files) {
        return;
      }

      const dataSources = Array.from(files).map(fileToDataSource);
      runAsLoading((setError) => loadFiles(dataSources, setError));
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

    // --- parse URL -- //

    const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

    onMounted(() => {
      if (!urlParams.urls) {
        return;
      }

      // TODO remove this nextTick when we switch away from
      // vue-toastification.
      // We run in nextTick to ensure the library is mounted.
      nextTick(() => {
        runAsLoading((setError) =>
          loadRemoteFilesFromURLParams(urlParams, setError)
        );
      });
    });

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

    const saveDialog = ref(false);
    const saveUrl =
      process.env.VUE_APP_ENABLE_REMOTE_SAVE && (urlParams.save as string);
    const saveHappening = ref(false);

    const handleSave = async () => {
      if (saveUrl) {
        try {
          saveHappening.value = true;

          const blob = await serialize();
          const saveResult = await fetch(saveUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/zip',
              'Content-Length': blob.size.toString(),
            },
            body: blob,
          });

          if (saveResult.ok) messageStore.addSuccess('Save Successful');
          else messageStore.addError('Save Failed', 'Network response not OK');
        } catch (error) {
          messageStore.addError(
            'Save Failed with error',
            `Failed from: ${error}`
          );
        } finally {
          saveHappening.value = false;
        }
      } else {
        saveDialog.value = true;
      }
    };

    const display = useDisplay();

    return {
      aboutBoxDialog: ref(false),
      messageDialog: ref(false),
      settingsDialog: ref(false),
      saveDialog,
      handleSave,
      saveHappening,
      leftSideBar: ref(!display.mobile.value),
      mobile: display.mobile,
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
#content-main {
  /* disable v-content transition when we resize our app drawer */
  transition: initial;
  width: 100%;
  height: 100%;
  position: fixed;
}

#left-nav {
  border-right: 1px solid rgb(var(--v-theme-background));
}

#content-main > .v-content__wrap {
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
#app-container {
  width: 100%;
  height: 100%;
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

.dnd-prompt {
  background: rgba(0, 0, 0, 0.4);
  color: white;
  border-radius: 8px;
  box-shadow: 0px 0px 10px 5px rgba(0, 0, 0, 0.4);
  padding: 64px;
}
</style>
