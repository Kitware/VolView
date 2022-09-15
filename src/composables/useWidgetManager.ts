import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { computed, Ref, watch } from '@vue/composition-api';

export function useWidgetManager(viewProxy: Ref<vtkViewProxy>) {
  const widgetManager = computed(() => {
    const wm = vtkWidgetManager.newInstance({ useSvgLayer: false });
    wm.setRenderer(viewProxy.value.getRenderer());
    return wm;
  });

  watch(widgetManager, (curWM, oldWM) => {
    oldWM.delete();
  });

  return { widgetManager };
}
