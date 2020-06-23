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
import { registerAllReaders } from './io/readers';
import proxyConfiguration from './vtk/proxy';

Vue.config.productionTip = false;

Vue.use(VueNotifications);
Vue.use(ProxyManagerVuePlugin);
Vue.use(EventBusPlugin);

const proxyManager = vtkProxyManager.newInstance({ proxyConfiguration });

const fileIO = new FileIO();
registerAllReaders(fileIO);

const dicomIO = new DicomIO();
dicomIO.initialize();

// Initialize global mapper topologies
// polys and lines in the front
vtkMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkMapper.setResolveCoincidentTopologyPolygonOffsetParameters(-1, -1);
vtkMapper.setResolveCoincidentTopologyLineOffsetParameters(-1, -1);
// image poly in the back
vtkImageMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkImageMapper.setResolveCoincidentTopologyPolygonOffsetParameters(1, 1);

const dependencies = {
  proxyManager,
  fileIO,
  dicomIO,
};

new Vue({
  store: createStore(dependencies),
  vuetify,
  proxyManager,
  render: (h) => h(App),
}).$mount('#app');
