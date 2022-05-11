<template>
  <v-container>
    <v-switch
      label="Enable Dark Theme" @change="onChange"
    ></v-switch>
  </v-container>
</template>

<script lang="ts">
import { defineComponent} from '@vue/composition-api';
import { useLocalStorage } from '@vueuse/core'
import vuetify from '../plugins/vuetify';

export default defineComponent({
  setup() {
    const store = useLocalStorage<boolean>("dark", false);

    const onChange = () => {
      vuetify.framework.theme.dark=!vuetify.framework.theme.dark;
      store.value = vuetify.framework.theme.dark;
    }

    return {
      onChange
    };
  },
});
</script>
