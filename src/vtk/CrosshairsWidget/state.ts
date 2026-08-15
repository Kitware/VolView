import type { Vector3 } from '@kitware/vtk.js/types';
import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';

export interface CrosshairsHandleWidgetState extends vtkWidgetState {
  setOrigin(origin: Vector3 | null): boolean;
  getOrigin(): Vector3 | null;
  setScale1(scale: number): boolean;
  getScale1(): number;
  setVisible(visible: boolean): boolean;
  getVisible(): boolean;
}

export interface CrosshairsWidgetState extends vtkWidgetState {
  setDragging(dragging: boolean): boolean;
  getDragging(): boolean;
  getHandle(): CrosshairsHandleWidgetState;
}

export default function generateState() {
  return vtkStateBuilder
    .createBuilder()
    .addField({
      name: 'dragging',
      initialValue: false,
    })
    .addStateFromMixin({
      labels: ['handle'],
      mixins: ['origin'],
      name: 'handle',
      initialValues: {
        origin: null,
      },
    })
    .build();
}
