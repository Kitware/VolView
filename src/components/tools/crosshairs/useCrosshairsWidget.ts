import { inject, onMounted, onScopeDispose, unref, type MaybeRef } from 'vue';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { VtkViewContext } from '@/src/components/vtk/context';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import type { vtkCrosshairsViewWidget } from '@/src/vtk/CrosshairsWidget';

export function useCrosshairsWidget(viewId: MaybeRef<string>) {
  const view = inject(VtkViewContext);
  if (!view) throw new Error('No VtkView');

  const crosshairs = useCrosshairsToolStore();
  const factory = crosshairs.getWidgetFactory();
  const widget = view.widgetManager.addWidget(
    factory
  ) as vtkCrosshairsViewWidget;
  const manipulator = vtkPlaneManipulator.newInstance();
  widget.setManipulator(manipulator);
  widget.setVisibility(true);
  let dragging = false;
  onVTKEvent(widget, 'onStartInteractionEvent', () => {
    dragging = true;
  });
  onVTKEvent(widget, 'onEndInteractionEvent', () => {
    dragging = false;
  });

  // Interaction belongs to the view that picked the shared handle.
  const handle = factory.getWidgetState().getHandle();
  onVTKEvent(widget, 'onInteractionEvent', () => {
    const origin = handle.getOrigin();
    if (!origin) return;
    crosshairs.setPosition(origin, unref(viewId));
  });

  onMounted(() => view.widgetManager.renderWidgets());
  onScopeDispose(() => {
    widget.setEnabled(false);
    view.interactor.cancelAnimation(widget, true);
    // A physical drag belongs to this view; a keyboard-only hold may continue
    // through remount in another view of the shared widget.
    if (dragging) {
      crosshairs.setDragging(false);
      view.renderWindowView.set({ cursor: 'default' });
    }
    view.widgetManager.removeWidget(factory);
    manipulator.delete();
  });

  return manipulator;
}
