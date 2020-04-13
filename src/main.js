import '@/public/global.css';

import Vue from 'vue';
import VueNotifications from 'vue-notification';
import vtkProxyManager from 'vtk.js/Sources/Proxy/Core/ProxyManager';
import App from './App.vue';
import createStore from './store';
import vuetify from './plugins/vuetify';
import { ProxyManagerVuePlugin } from './plugins/proxyManager';
import EventBusPlugin from './plugins/events';
import { FileLoader } from './io/io';
import { registerAllReaders } from './io/readers';
import proxyConfiguration from './vtk/proxy';
import DaikonDatabase from './io/dicom/daikon';

Vue.config.productionTip = false;

Vue.use(VueNotifications);
Vue.use(ProxyManagerVuePlugin);
Vue.use(EventBusPlugin);

const proxyManager = vtkProxyManager.newInstance({ proxyConfiguration });

const loader = new FileLoader();
registerAllReaders(loader);

const dicomDB = new DaikonDatabase();

const services = {
  proxyManager,
  loader,
  dicomDB,
};

new Vue({
  store: createStore(services),
  vuetify,
  proxyManager,
  render: (h) => h(App),
}).$mount('#app');
