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
import { FileIO } from './io/io';
import { DICOMIO } from './io/dicom';
import { createTREReader, registerAllReaders } from './io/readers';
import { setCurrentInstance } from './instances';
import proxyConfiguration from './vtk/proxy';
import WidgetProvider from './widgets/widgetProvider';
import { FileIOInst, DICOMIOInst, ProxyManagerInst } from './constants';
import { updateRulerFromWidgetStateEvent } from './store/tools/rulers';
import { provideToolManagers, CorePiniaProviderPlugin } from './core/provider';

Vue.config.productionTip = false;

Vue.use(VueCompositionAPI);
Vue.use(VueNotifications);
Vue.use(ProxyManagerVuePlugin);
Vue.use(PiniaVuePlugin);

const proxyManager = vtkProxyManager.newInstance({ proxyConfiguration });
setCurrentInstance(ProxyManagerInst, proxyManager);

const fileIO = new FileIO();
registerAllReaders(fileIO);
setCurrentInstance(FileIOInst, fileIO);

const dicomIO = new DICOMIO();
dicomIO.initialize();
setCurrentInstance(DICOMIOInst, dicomIO);

// Right now, TRE reader depends on the DicomIO module since
// that's where the TRE read logic resides.
fileIO.addSingleReader('tre', createTREReader(dicomIO));

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
  fileIO,
  dicomIO,
};

const store = createStore(dependencies);
const widgetProvider = new WidgetProvider(store);

const toolManagers = provideToolManagers();

const pinia = createPinia();
pinia.use(
  CorePiniaProviderPlugin({
    toolManagers,
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
