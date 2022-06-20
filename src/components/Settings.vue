<template>
  <v-container>
    <v-switch label="Enable Dark Theme" v-model="dark"></v-switch>
  </v-container>
</template>

<script lang="ts">
import { defineComponent, watchEffect } from '@vue/composition-api';
import { useLocalStorage } from '@vueuse/core';
import vuetify from '../plugins/vuetify';

export default defineComponent({
  setup() {
    const store = useLocalStorage<boolean>('dark', false);

    watchEffect(() => {
      vuetify.framework.theme.dark = store.value;
    });

    return {
      dark: store,
    };
  },
});
</script>
