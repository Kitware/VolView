import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import {
  HANDLE_PIXEL_SIZE,
  POINTS_LABEL,
} from '@/src/vtk/ToolWidgetUtils/common';

export default function createState() {
  return vtkStateBuilder
    .createBuilder()
    .addStateFromMixin({
      name: 'firstPoint',
      labels: [POINTS_LABEL],
      mixins: ['visible', 'origin', 'scale1'],
      initialValues: {
        visible: false,
        scale1: HANDLE_PIXEL_SIZE,
      },
    })
    .addStateFromMixin({
      name: 'secondPoint',
      labels: [POINTS_LABEL],
      mixins: ['visible', 'origin', 'scale1'],
      initialValues: {
        visible: false,
        scale1: HANDLE_PIXEL_SIZE,
      },
    })
    .build();
}
