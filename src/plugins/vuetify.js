import { createVuetify } from 'vuetify';
import { useLocalStorage } from '@vueuse/core';

import KitwareMark from '@/src/components/icons/KitwareLogoIcon.vue';

const store = useLocalStorage('dark', true);

export default createVuetify({
  icons: {
    values: {
      kitwareMark: {
        component: KitwareMark,
      },
    },
  },
  theme: {
    defaultTheme: store.value ? 'dark' : 'light',
  },
  breakpoint: {
    mobileBreakpoint: 'sm',
  },
});
