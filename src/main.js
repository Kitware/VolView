import '@/public/global.css';

import Vue from 'vue';
import VueNotifications from 'vue-notification';
import vtkProxyManager from 'vtk.js/Sources/Proxy/Core/ProxyManager';
import vtkMapper from 'vtk.js/Sources/Rendering/Core/Mapper';
import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';

import App from './App.vue';
import createStore from './store';
import vuetify from './plugins/vuetify';
import { ProxyManagerVuePlugin } from './plugins/proxyManager';
import EventBusPlugin from './plugins/events';
import { FileIO } from './io/io';
import DicomIO from './io/dicom';
import { createTREReader, registerAllReaders } from './io/readers';
import proxyConfiguration from './vtk/proxy';
import WidgetProvider from './widgets/widgetProvider';

Vue.config.productionTip = false;

Vue.use(VueNotifications);
Vue.use(ProxyManagerVuePlugin);
Vue.use(EventBusPlugin);

const proxyManager = vtkProxyManager.newInstance({ proxyConfiguration });

const fileIO = new FileIO();
registerAllReaders(fileIO);

const dicomIO = new DicomIO();
dicomIO.initialize();

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

new Vue({
  store,
  vuetify,
  proxyManager,
  provide: {
    widgetProvider,
  },
  render: (h) => h(App),
}).$mount('#app');
