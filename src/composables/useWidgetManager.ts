import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { CaptureOn } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import { computed, onUnmounted, Ref, watch } from 'vue';
import { onViewProxyMounted, onViewProxyUnmounted } from './useViewProxy';

export function useWidgetManager(viewProxy: Ref<vtkViewProxy>) {
  const widgetManager = computed(() => {
    const wm = vtkWidgetManager.newInstance({
      pickingEnabled: false,
      useSvgLayer: false,
      captureOn: CaptureOn.MOUSE_MOVE,
    });
    return wm;
  });

  onViewProxyMounted(viewProxy, () => {
    widgetManager.value.setRenderer(viewProxy.value.getRenderer());
    widgetManager.value.enablePicking();
  });

  onViewProxyUnmounted(viewProxy, () => {
    widgetManager.value.disablePicking();
  });

  watch(widgetManager, (curWM, oldWM) => {
    if (curWM) {
      curWM.setRenderer(viewProxy.value.getRenderer());
      curWM.enablePicking();
    }
    if (oldWM) {
      oldWM.delete();
    }
  });

  onUnmounted(() => {
    widgetManager.value.delete();
  });

  return { widgetManager };
}
