import '@/public/global.css';

import Vue from 'vue';
import App from './App.vue';
import createStore from './store';
import vuetify from './plugins/vuetify';
import { FileLoader } from './io/io';
import { registerAllReaders } from './io/readers';

Vue.config.productionTip = false;

const loader = new FileLoader();
registerAllReaders(loader);

const services = {
  loader,
};

new Vue({
  store: createStore(services),
  vuetify,
  render: (h) => h(App),
}).$mount('#app');
