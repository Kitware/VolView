<template>
  <v-card>
    <v-card-title>
      Settings
      <v-spacer />
      <v-btn icon @click="$emit('close')"><v-icon>mdi-close</v-icon></v-btn>
    </v-card-title>
    <v-card-text>
      <v-switch label="Enable Dark Theme" v-model="dark"></v-switch>
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, watchEffect } from '@vue/composition-api';
import { useLocalStorage } from '@vueuse/core';
import vuetify from '../plugins/vuetify';

export default defineComponent({
  setup() {
    const store = useLocalStorage<boolean>(
      'dark',
      vuetify.framework.theme.dark ?? true
    );

    watchEffect(() => {
      vuetify.framework.theme.dark = store.value;
    });

    return {
      dark: store,
    };
  },
});
</script>
