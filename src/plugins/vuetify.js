import Vue from 'vue';
import Vuetify from 'vuetify/lib';

import KitwareMark from '@/src/components/icons/KitwareLogoIcon.vue';

Vue.use(Vuetify);

export default new Vuetify({
  icons: {
    values: {
      kitwareMark: {
        component: KitwareMark,
      },
    },
  },
});
