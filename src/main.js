import '@/public/global.css';
import '@kitware/vtk.js/Rendering/Profiles/All';
import 'vue-toastification/dist/index.css';

import Vue from 'vue';
import VueCompositionAPI from '@vue/composition-api';
import VueToast from 'vue-toastification';
import { createPinia, PiniaVuePlugin } from 'pinia';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';

import App from './components/App.vue';
import vuetify from './plugins/vuetify';
import { ProxyManagerVuePlugin } from './plugins/proxyManager';
import { DICOMIO } from './io/dicom';
import { FILE_READERS } from './io';
import { registerAllReaders } from './io/readers';
import { setCurrentInstance } from './instances';
import proxyConfiguration from './vtk/proxy';
import { DICOMIOInst, ProxyManagerInst } from './constants';
import { CorePiniaProviderPlugin } from './core/provider';
import ProxyWrapper from './core/proxies';

Vue.config.productionTip = false;

Vue.use(VueCompositionAPI);
Vue.use(VueToast);
Vue.use(ProxyManagerVuePlugin);
Vue.use(PiniaVuePlugin);

// Initialize global mapper topologies
// polys and lines in the front
vtkMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkMapper.setResolveCoincidentTopologyPolygonOffsetParameters(-3, -3);
vtkMapper.setResolveCoincidentTopologyLineOffsetParameters(-3, -3);
// image poly in the back
vtkImageMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkImageMapper.setResolveCoincidentTopologyPolygonOffsetParameters(1, 1);

registerAllReaders(FILE_READERS);

const proxyManager = vtkProxyManager.newInstance({ proxyConfiguration });
setCurrentInstance(ProxyManagerInst, proxyManager);

const dicomIO = new DICOMIO();
dicomIO.initialize();
setCurrentInstance(DICOMIOInst, dicomIO);

const pinia = createPinia();
pinia.use(
  CorePiniaProviderPlugin({
    proxies: new ProxyWrapper(proxyManager),
  })
);

const app = new Vue({
  vuetify,
  proxyManager,
  pinia,
  provide: {
    ProxyManager: proxyManager,
  },
  render: (h) => h(App),
});

app.$mount('#app');
