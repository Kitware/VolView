import { defineStore } from 'pinia';
import { ref, Ref } from 'vue';
import vtkWebXRRenderWindowHelper from '@kitware/vtk.js/Rendering/WebXR/RenderWindowHelper';

export const useVTKWebXRStore = defineStore('vtkWebXR', () => {
    const xrHelper = vtkWebXRRenderWindowHelper.newInstance();
    const selectedXrSessionType : Ref<{title: string, value: number} | null> = ref(null);
    const isXrSessionTypeLocked = ref(false);

    function isXrSessionRunning() : Boolean {
        return !!xrHelper.getXrSession();
    }

  return {
    xrHelper,
    selectedXrSessionType,
    isXrSessionTypeLocked,
    isXrSessionRunning
  };
});

export default useVTKWebXRStore;
