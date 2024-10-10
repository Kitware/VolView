import 'vue-toastification/dist/index.css';
import 'vuetify/lib/styles/main.css';
import '@/src/global.css';

import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Volume';
import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Glyph';

import { createApp } from 'vue';
import VueToast from 'vue-toastification';
import { createPinia } from 'pinia';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';

import { setPipelinesBaseUrl, setPipelineWorkerUrl } from 'itk-wasm';
import { setPipelinesBaseUrl as imageIoSetPipelinesBaseUrl } from '@itk-wasm/image-io';
import itkConfig from '@/src/io/itk/itkConfig';

import App from './components/App.vue';
import vuetify from './plugins/vuetify';
import { FILE_READERS } from './io';
import { registerAllReaders } from './io/readers';
import { CorePiniaProviderPlugin } from './core/provider';
import { patchExitPointerLock } from './utils/hacks';
import { init as initErrorReporting } from './utils/errorReporting';
import { StoreRegistry } from './plugins/storeRegistry';
import { initItkWorker } from './io/itk/worker';

// patches
patchExitPointerLock();

initItkWorker();

// Initialize global mapper topologies
// polys and lines in the front
vtkMapper.setResolveCoincidentTopologyToPolygonOffset();
vtkMapper.setResolveCoincidentTopologyPolygonOffsetParameters(-3, -3);
vtkMapper.setResolveCoincidentTopologyLineOffsetParameters(-3, -3);

registerAllReaders(FILE_READERS);

// Must be set at runtime as new version of @itk-wasm/dicom and @itk-wasm/image-io
// do not pickup build time `../itkConfig` alias remap.
setPipelinesBaseUrl(itkConfig.pipelinesUrl);
setPipelineWorkerUrl(itkConfig.pipelineWorkerUrl);
imageIoSetPipelinesBaseUrl(itkConfig.imageIOUrl);

const pinia = createPinia();
pinia.use(CorePiniaProviderPlugin({}));
pinia.use(StoreRegistry);

const app = createApp(App);

initErrorReporting(app);

app.use(pinia);
app.use(VueToast);
app.use(vuetify);
app.mount('#app');
