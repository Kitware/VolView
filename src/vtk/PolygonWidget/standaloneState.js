import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import { HANDLE_PIXEL_SIZE } from '@/src/vtk/ToolWidgetUtils/common';
import { HandlesLabel, MoveHandleLabel } from '@/src/vtk/PolygonWidget/common';

export default function createState() {
  return vtkStateBuilder
    .createBuilder()
    .addDynamicMixinState({
      name: 'handle',
      labels: [HandlesLabel],
      mixins: ['visible', 'origin', 'scale1'],
      initialValues: {
        visible: true,
        scale1: HANDLE_PIXEL_SIZE,
      },
    })
    .addStateFromMixin({
      name: 'moveHandle',
      labels: [HandlesLabel, MoveHandleLabel],
      mixins: ['visible', 'origin', 'scale1'],
      initialValues: {
        visible: true,
        scale1: HANDLE_PIXEL_SIZE,
      },
    })
    .addField({
      name: 'finishable',
      initialValue: false,
    })
    .addField({
      name: 'placing',
      initialValue: false,
    })
    .build();
}
