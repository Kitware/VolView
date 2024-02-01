<template>
  <drag-and-drop enabled @drop-files="loadFiles" id="app-container">
    <template v-slot="{ dragHover }">
      <v-app>
        <app-bar @click:left-menu="leftSideBar = !leftSideBar"></app-bar>
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
                @click="loadUserPromptedFiles"
              />
              <tool-button
                size="40"
                icon="mdi-content-save-all"
                name="Save session"
                :loading="saveHappening"
                @click="handleSave"
              />
              <div class="my-1 tool-separator" />
              <v-menu location="right" :close-on-content-click="true">
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
              <tool-button
                v-if="serverUrl"
                size="40"
                :icon="serverConnectionIcon"
                name="Open Server Settings"
                @click="settingsDialog = true"
              />
              <v-badge
                offset-x="10"
                offset-y="10"
                :content="messageCount"
                :color="messageBadgeColor"
                :model-value="messageCount > 0"
                id="notifications"
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
              <welcome-page
                v-if="!hasData"
                :loading="showLoading"
                class="clickable"
                @click="loadUserPromptedFiles"
              >
                <div v-if="!saveUrl" class="vertical-offset-margin">
                  <v-icon size="64">mdi-cloud-off-outline</v-icon>
                </div>
                <div v-if="!saveUrl">
                  Secure: Image data never leaves your machine.
                </div>
                <v-btn
                  class="mt-2"
                  variant="tonal"
                  color="secondary"
                  @click.stop="dataSecurityDialog = true"
                >
                  Learn More
                </v-btn>
              </welcome-page>
            </div>
          </div>
        </v-main>

        <closeable-dialog v-model="messageDialog" content-class="fill-height">
          <message-center />
        </closeable-dialog>

        <message-notifications @open-notifications="messageDialog = true" />

        <closeable-dialog v-model="settingsDialog">
          <settings />
        </closeable-dialog>

        <closeable-dialog v-model="saveDialog" max-width="30%">
          <template v-slot="{ close }">
            <save-session :close="close" />
          </template>
        </closeable-dialog>

        <closeable-dialog v-model="dataSecurityDialog">
          <data-security-box />
        </closeable-dialog>

        <keyboard-shortcuts />
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
  onMounted,
  provide,
  Ref,
  ref,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { UrlParams } from '@vueuse/core';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { useDisplay } from 'vuetify';
import useLoadDataStore from '@/src/store/load-data';
import AppBar from '@/src/components/AppBar.vue';
import {
  loadFiles,
  loadUserPromptedFiles,
  loadUrls,
} from '@/src/actions/loadUserFiles';
import vtkResliceCursorWidget, {
  ResliceCursorWidgetState,
} from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import type { Vector3 } from '@kitware/vtk.js/types';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import WelcomePage from '@/src/components/WelcomePage.vue';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import ToolButton from './ToolButton.vue';
import LayoutGrid from './LayoutGrid.vue';
import ModulePanel from './ModulePanel.vue';
import DragAndDrop from './DragAndDrop.vue';
import CloseableDialog from './CloseableDialog.vue';
import ToolStrip from './ToolStrip.vue';
import MessageCenter from './MessageCenter.vue';
import MessageNotifications from './MessageNotifications.vue';
import Settings from './Settings.vue';
import PersistentOverlay from './PersistentOverlay.vue';
import DataSecurityBox from './DataSecurityBox.vue';
import KeyboardShortcuts from './KeyboardShortcuts.vue';
import { useImageStore } from '../store/datasets-images';
import { useViewStore } from '../store/views';
import { ConnectionState, useServerStore } from '../store/server';
import { MessageType, useMessageStore } from '../store/messages';
import { Layouts } from '../config';
import { serialize } from '../io/state-file';
import SaveSession from './SaveSession.vue';
import { useGlobalErrorHook } from '../composables/useGlobalErrorHook';
import { useWebGLWatchdog } from '../composables/useWebGLWatchdog';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts';
import { VTKResliceCursor } from '../constants';

export default defineComponent({
  name: 'App',

  components: {
    ToolButton,
    LayoutGrid,
    DragAndDrop,
    CloseableDialog,
    DataSecurityBox,
    ToolStrip,
    ModulePanel,
    MessageCenter,
    MessageNotifications,
    Settings,
    SaveSession,
    PersistentOverlay,
    KeyboardShortcuts,
    WelcomePage,
    AppBar,
  },

  setup() {
    const imageStore = useImageStore();
    const dicomStore = useDICOMStore();
    const messageStore = useMessageStore();
    const viewStore = useViewStore();

    useGlobalErrorHook();
    useWebGLWatchdog();
    useKeyboardShortcuts();

    const { currentImageData, currentImageMetadata } = useCurrentImage();

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

    // --- ResliceCursorWidget --- //
    // Construct the common instance of vtkResliceCursorWidget and provide it
    // to all the child ObliqueView components.
    const resliceCursor = vtkResliceCursorWidget.newInstance({
      scaleInPixels: true,
      rotationHandlePosition: 0.75,
    }) as vtkResliceCursorWidget;
    provide(VTKResliceCursor, resliceCursor);

    // TODO: Move this to a store/global-state for reslicing.
    // Orient the planes of the vtkResliceCursorWidget to the orientation
    // of the currently set image.
    const resliceCursorState =
      resliceCursor.getWidgetState() as ResliceCursorWidgetState;

    // Temporary fix to disable race between PanTool and ResliceCursorWidget
    resliceCursorState.setScrollingMethod(-1);

    watch(currentImageData, (image) => {
      if (image && resliceCursor) {
        resliceCursor.setImage(image);
        // Reset to default plane values before transforming based on current image-data.
        resliceCursorState.setPlanes({
          [ViewTypes.YZ_PLANE]: {
            normal: [1, 0, 0],
            viewUp: [0, 0, 1],
          },
          [ViewTypes.XZ_PLANE]: {
            normal: [0, -1, 0],
            viewUp: [0, 0, 1],
          },
          [ViewTypes.XY_PLANE]: {
            normal: [0, 0, -1],
            viewUp: [0, -1, 0],
          },
        });
        const planes = resliceCursorState.getPlanes();
        if (currentImageMetadata.value) {
          planes[ViewTypes.XY_PLANE].normal = currentImageMetadata.value
            .lpsOrientation.Inferior as Vector3;
          planes[ViewTypes.XY_PLANE].viewUp = currentImageMetadata.value
            .lpsOrientation.Anterior as Vector3;

          planes[ViewTypes.XZ_PLANE].normal = currentImageMetadata.value
            .lpsOrientation.Anterior as Vector3;
          planes[ViewTypes.XZ_PLANE].viewUp = currentImageMetadata.value
            .lpsOrientation.Superior as Vector3;

          planes[ViewTypes.YZ_PLANE].normal = currentImageMetadata.value
            .lpsOrientation.Left as Vector3;
          planes[ViewTypes.YZ_PLANE].viewUp = currentImageMetadata.value
            .lpsOrientation.Superior as Vector3;
        }
      }
    });

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

    // --- parse URL -- //

    const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

    onMounted(() => {
      if (!urlParams.urls) {
        return;
      }

      loadUrls(urlParams);
    });

    // --- remote server --- //

    const serverStore = useServerStore();
    const { url: serverUrl } = storeToRefs(serverStore);

    const serverConnectionIcon = computed(() => {
      switch (serverStore.connState) {
        case ConnectionState.Connected:
          return 'mdi-lan-check';
        case ConnectionState.Disconnected:
          return 'mdi-lan-disconnect';
        case ConnectionState.Pending:
          return 'mdi-lan-pending';
        default:
          throw new Error('Invalid connection state');
      }
    });

    onMounted(() => {
      serverStore.connect();
    });

    // --- --- //

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
      import.meta.env.VITE_ENABLE_REMOTE_SAVE && (urlParams.save as string);
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
      messageDialog: ref(false),
      settingsDialog: ref(false),
      dataSecurityDialog: ref(false),
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
      loadUserPromptedFiles,
      loadFiles,
      hasData,
      saveUrl,
      serverConnectionIcon,
      serverUrl,
      showLoading,
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
