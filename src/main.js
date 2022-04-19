import '@/public/global.css';
import '@kitware/vtk.js/Rendering/Profiles/All';

import Vue from 'vue';
import VueCompositionAPI from '@vue/composition-api';
import VueNotifications from 'vue-notification';
import { createPinia, PiniaVuePlugin } from 'pinia';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';

import App from './components/App.vue';
import createStore from './store';
import vuetify from './plugins/vuetify';
import { ProxyManagerVuePlugin } from './plugins/proxyManager';
import { DICOMIO } from './io/dicom';
import { setCurrentInstance } from './instances';
import proxyConfiguration from './vtk/proxy';
import WidgetProvider from './widgets/widgetProvider';
import { DICOMIOInst, ProxyManagerInst } from './constants';
import { updateRulerFromWidgetStateEvent } from './store/tools/rulers';
import ProxyManager from './core/proxies';
import { provideToolManagers, CorePiniaProviderPlugin } from './core/provider';
import IDManager from './core/id';

Vue.config.productionTip = false;

Vue.use(VueCompositionAPI);
Vue.use(VueNotifications);
Vue.use(ProxyManagerVuePlugin);
Vue.use(PiniaVuePlugin);

const proxyManager = vtkProxyManager.newInstance({ proxyConfiguration });
setCurrentInstance(ProxyManagerInst, proxyManager);

const dicomIO = new DICOMIO();
dicomIO.initialize();
setCurrentInstance(DICOMIOInst, dicomIO);

// Initialize global mapper topologies
// polys and lines in the front
vtkMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkMapper.setResolveCoincidentTopologyPolygonOffsetParameters(-3, -3);
vtkMapper.setResolveCoincidentTopologyLineOffsetParameters(-3, -3);
// image poly in the back
vtkImageMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkImageMapper.setResolveCoincidentTopologyPolygonOffsetParameters(1, 1);

const dependencies = {
  proxyManager,
  dicomIO,
};

const store = createStore(dependencies);
const widgetProvider = new WidgetProvider(store);

const toolManagers = provideToolManagers();
const coreProxyManager = new ProxyManager(proxyManager);
const idManager = new IDManager();

const pinia = createPinia();
pinia.use(
  CorePiniaProviderPlugin({
    toolManagers,
    idManager,
    proxyManager: coreProxyManager,
  })
);

toolManagers.ruler.events.on('widgetUpdate', updateRulerFromWidgetStateEvent);

const app = new Vue({
  store,
  vuetify,
  proxyManager,
  pinia,
  provide: {
    widgetProvider,
    ProxyManager: proxyManager,
    Store: store,
  },
  render: (h) => h(App),
});

app.$mount('#app');
