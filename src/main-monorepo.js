// import 'vue-toastification/dist/index.css'; // Comentado para evitar estilos globales
// import 'vuetify/lib/styles/main.css'; // Comentado para evitar sobrescribir el tema principal
// import './global.css'; // Comentado para evitar conflictos de estilos globales

import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Volume';
import '@kitware/vtk.js/Rendering/OpenGL/Profiles/Glyph';

import { createApp } from 'vue';
import VueToast from 'vue-toastification';
import { createPinia } from 'pinia';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';

import { setPipelinesBaseUrl, setPipelineWorkerUrl } from 'itk-wasm';
import { setPipelinesBaseUrl as imageIoSetPipelinesBaseUrl } from '@itk-wasm/image-io';
import itkConfig from './io/itk/itkConfig';

import App from './components/AppEmbedded.vue';
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

// Must be set at runtime as new version of @itk-wasm/dicom and @itk-wasm/image-io
// do not pickup build time `../itkConfig` alias remap.
setPipelinesBaseUrl(itkConfig.pipelinesUrl);
setPipelineWorkerUrl(itkConfig.pipelineWorkerUrl);
imageIoSetPipelinesBaseUrl(itkConfig.imageIOUrl);

// Export initialization function for monorepo integration
export async function initVolViewApp(container, options = {}) {
  try {
    // Create Pinia instance
    const pinia = createPinia();
    pinia.use(CorePiniaProviderPlugin({}));
    pinia.use(StoreRegistry);

    // Create Vue app
    const app = createApp(App);

    // Initialize error reporting
    initErrorReporting(app);

    // Use plugins
    app.use(pinia);
    // Configurar VueToast sin estilos globales
    app.use(VueToast, {
      container,
      newestOnTop: false,
      position: "top-right",
      timeout: 5000,
      closeOnClick: true,
      pauseOnFocusLoss: true,
      pauseOnHover: true,
      draggable: true,
      draggablePercent: 0.6,
      showCloseButtonOnHover: false,
      hideProgressBar: false,
      closeButton: "button",
      icon: true,
      rtl: false,
      // Evitar inyección de estilos globales
      shareAppContext: false
    });
    
    // Use the shared Vuetify instance from the host application
    if (options.vuetify) {
      console.log('Using shared Vuetify instance from host');
      app.use(options.vuetify);
    } else {
      console.warn('No Vuetify instance provided from host, VolView may not display correctly');
      // Fallback: create minimal instance if no shared instance provided
      const { createVuetify } = await import('vuetify');
      const vuetifyForVolView = createVuetify({
        display: {
          mobileBreakpoint: 'lg',
          thresholds: {
            lg: 1024,
          },
        },
      });
      app.use(vuetifyForVolView);
    }

    // Mount the app normally
    app.mount(container);

    return {
      app,
      pinia,
      unmount: () => {
        app.unmount();
      },
      getInstance: () => app
    };
  } catch (error) {
    console.error('Error initializing VolView:', error);
    throw error;
  }
}

// Keep original initialization for standalone use
export function initStandaloneVolView() {
  const pinia = createPinia();
  pinia.use(CorePiniaProviderPlugin({}));
  pinia.use(StoreRegistry);

  const app = createApp(App);

  initErrorReporting(app);

  app.use(pinia);
  app.use(VueToast);
  // app.use(vuetify); // No usar vuetify de VolView para evitar conflictos de tema
  app.mount('#app');

  return app;
}
