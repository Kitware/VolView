import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import { useLocalStorage } from '@vueuse/core';

import KitwareMark from '@/src/components/icons/KitwareLogoIcon.vue';

Vue.use(Vuetify);

const store = useLocalStorage('dark', false);

export default new Vuetify({
  icons: {
    values: {
      kitwareMark: {
        component: KitwareMark,
      },
    },
  },
  theme: {
    dark: store.value,
  },
});
