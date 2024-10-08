<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">Settings</v-card-title>
    <v-card-text>
      <v-switch
        :label="`Dark Theme (${dark ? 'On' : 'Off'})`"
        v-model="dark"
        color="secondary"
        density="compact"
        hide-details
      ></v-switch>

      <v-switch
        :label="`Camera Auto Reset (${disableCameraAutoReset ? 'On' : 'Off'})`"
        v-model="disableCameraAutoReset"
        color="secondary"
        density="compact"
        hide-details
      ></v-switch>

      <v-switch
        v-if="errorReportingConfigured"
        :label="`Error Reporting (${reportingEnabled ? 'On' : 'Off'})`"
        v-model="reportingEnabled"
        color="secondary"
        density="compact"
        hide-details
      ></v-switch>

      <v-btn
        class="my-2"
        @click="openKeyboardShortcuts"
        prepend-icon="mdi-keyboard"
        color="secondary"
      >
        Keyboard Shortcuts
      </v-btn>

      <v-divider class="mt-2 mb-6"></v-divider>
      <dicom-web-settings />

      <v-divider class="mt-2 mb-6"></v-divider>
      <server-settings />
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useTheme } from 'vuetify';
import { useLocalStorage } from '@vueuse/core';

import { useKeyboardShortcutsStore } from '@/src/store/keyboard-shortcuts';
import DicomWebSettings from './dicom-web/DicomWebSettings.vue';
import ServerSettings from './ServerSettings.vue';
import { DarkTheme, LightTheme, ThemeStorageKey } from '../constants';
import {
  useErrorReporting,
  errorReportingConfigured,
} from '../utils/errorReporting';
import { useViewCameraStore } from '@/src/store/view-configs/camera';

export default defineComponent({
  setup() {
    const theme = useTheme();
    const store = useLocalStorage(ThemeStorageKey, theme.global.name.value);
    const dark = ref(theme.global.name.value === DarkTheme);

    watch(dark, (isDark) => {
      theme.global.name.value = isDark ? DarkTheme : LightTheme;
      store.value = theme.global.name.value;
    });

    const errorReportingStore = useErrorReporting();
    const reportingEnabled = ref(!errorReportingStore.disableReporting);
    watch(reportingEnabled, (enabled) => {
      errorReportingStore.disableReporting = !enabled;
    });

    const { disableCameraAutoReset } = storeToRefs(useViewCameraStore());

    const keyboardStore = useKeyboardShortcutsStore();
    const openKeyboardShortcuts = () => {
      keyboardStore.settingsOpen = true;
    };

    return {
      dark,
      reportingEnabled,
      errorReportingConfigured,
      openKeyboardShortcuts,
      disableCameraAutoReset,
    };
  },
  components: {
    DicomWebSettings,
    ServerSettings,
  },
});
</script>
