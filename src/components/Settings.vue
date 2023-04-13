<template>
  <v-card>
    <v-card-title class="d-flex flex-row align-center">
      Settings
      <v-spacer />
      <v-btn variant="text" icon="mdi-close" @click="$emit('close')" />
    </v-card-title>
    <v-card-text>
      <v-switch label="Dark Theme" v-model="dark"></v-switch>

      <v-divider class="mt-2 mb-6"></v-divider>
      <dicom-web-settings />
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, watchEffect } from 'vue';
import { useTheme } from 'vuetify';
import { useLocalStorage } from '@vueuse/core';

import DicomWebSettings from './dicom-web/DicomWebSettings.vue';

export default defineComponent({
  setup() {
    const theme = useTheme();
    const store = useLocalStorage<boolean>(
      'dark',
      theme.global.current.value.dark ?? true
    );

    watchEffect(() => {
      theme.global.name.value = store.value ? 'dark' : 'light';
    });

    return {
      dark: store,
    };
  },
  components: {
    DicomWebSettings,
  },
});
</script>
