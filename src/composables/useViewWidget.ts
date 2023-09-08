import { Maybe } from '@/src/types';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { onMounted, onUnmounted, ref, unref } from 'vue';
import type { Ref, MaybeRef, UnwrapRef } from 'vue';

export function useViewWidget<T extends vtkAbstractWidget>(
  factory: vtkAbstractWidgetFactory,
  widgetManager: MaybeRef<vtkWidgetManager>
) {
  const widget = ref<Maybe<T>>(null);

  onMounted(() => {
    widget.value = unref(widgetManager).addWidget(factory) as UnwrapRef<T>;
  });

  onUnmounted(() => {
    if (!widget.value) return;
    unref(widgetManager).removeWidget(widget.value);
    widget.value.delete();
  });

  return widget as Ref<Maybe<T>>;
}
