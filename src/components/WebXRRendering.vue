<script setup lang="ts">
import {
  ref,
} from 'vue';

import { XrSessionTypes } from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper/Constants.js';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useViewProxy } from '../composables/useViewProxy';
import useVTKWebXRStore from '../store/view-configs/webxr';
import { ViewProxyType } from '../core/proxies';
import { InitViewIDs } from '../config';

const TARGET_VIEW_ID = InitViewIDs.Three;
const vtkWebXRStore = useVTKWebXRStore();

const xrSessionRunning = ref(vtkWebXRStore.isXrSessionRunning());
    
const namedXrSessionTypes = [
  { value: 0, title: 'VR Headset'},
  { value: 1, title: 'AR Mobile Device'},
  { value: 2, title: 'Holographic Display'},
  { value: 3, title: 'AR Headset'},
];

function updateXRStateFunc() {
  xrSessionRunning.value = !!vtkWebXRStore.xrHelper.getXrSession();
};

function startXRFunc(sessionType:XrSessionTypes) {
  const { viewProxy } = useViewProxy(TARGET_VIEW_ID, ViewProxyType.Volume);
  vtkWebXRStore.xrHelper.setRenderWindow((viewProxy.value as any).getOpenGLRenderWindow());
  vtkWebXRStore.xrHelper.startXR(sessionType);
}

onVTKEvent(vtkWebXRStore.xrHelper, 'onModified', updateXRStateFunc);

function onSendToXRClick() {
  if(vtkWebXRStore.xrHelper.getXrSession() !== null) {
    throw new Error('Cannot send to XR: session already running');
  }
  if(vtkWebXRStore.selectedXrSessionType === null) {
    throw new Error('Cannot send to XR: no session type selected');
  }

  const xrSessionType = vtkWebXRStore.selectedXrSessionType ? vtkWebXRStore.selectedXrSessionType.value : 0;

  if(xrSessionType === XrSessionTypes.LookingGlassVR) {
    // The Looking Glass WebXR Polyfill overrides support for other XR sessions.
    vtkWebXRStore.isXrSessionTypeLocked = true;

    // Import the Looking Glass WebXR Polyfill override.
    // Assumes that the Looking Glass Bridge native application is already running.
    // See https://docs.lookingglassfactory.com/developer-tools/webxr
    import(
      // @ts-expect-error TS2307
      // eslint-disable-next-line import/no-unresolved, import/extensions
      /* webpackIgnore: true */ 'https://unpkg.com/@lookingglass/webxr@0.4.0/dist/bundle/webxr.js'
    ).then((obj) => {
      // eslint-disable-next-line no-new
      new obj.LookingGlassWebXRPolyfill();

      // There is a delay between when the Looking Glass polyfill starts and when
      // the Looking Glass Bridge application finishes populating device information.
      // Attempting to start the XR session in the intermediate period can result in
      // undefined behavior such as a failure to start the session or an attempt to start
      // a standard VR HMD session.
      // A timeout of 1 second is used to account for this delay as a workaround.
      // In the future we may explore handling an event notification from the Looking Glass polyfill
      // when a new Looking Glass device is ready for WebXR rendering.
      setTimeout(() => startXRFunc(xrSessionType), 1000);
    });
  } else if((navigator as any).xr === undefined) {
    import(
    // @ts-expect-error TS2307
    // eslint-disable-next-line import/no-unresolved, import/extensions
    /* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/webxr-polyfill@latest/build/webxr-polyfill.js'
    ).then(() => {
      startXRFunc(xrSessionType);
    })
  } else {
    startXRFunc(xrSessionType);
  }
};

function onReturnFromXRClick() {
  if(vtkWebXRStore.xrHelper.getXrSession() === null) {
    throw new Error('Cannot return from XR: no session running');
  }
  vtkWebXRStore.xrHelper.stopXR();
};

</script>

<template>
  <div class="mx-2">
    <v-combobox
    v-model="vtkWebXRStore.selectedXrSessionType"
    :items="namedXrSessionTypes"
    label="Mixed Reality Session Type"
    item-text="title"
    item-value="value"
    :disabled="vtkWebXRStore.isXrSessionTypeLocked"
    />
    <button v-if="!xrSessionRunning && vtkWebXRStore.selectedXrSessionType" @click="onSendToXRClick">
      Send to {{ vtkWebXRStore.selectedXrSessionType.title }}
    </button>
    <button v-if="xrSessionRunning" @click="onReturnFromXRClick">Return from XR</button>
  </div>
</template>
