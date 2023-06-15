import type { Bounds, Vector3 } from '@kitware/vtk.js/types';
import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import { mat4 } from 'gl-matrix';

export interface CrosshairsHandleWidgetState extends vtkWidgetState {
  setOrigin(origin: Vector3 | null): boolean;
  getOrigin(): Vector3 | null;
  setScale1(scale: number): boolean;
  getScale1(): number;
  setVisible(visible: boolean): boolean;
  getVisible(): boolean;
  setBounds(bounds: Bounds): boolean;
  getBounds(): Bounds;
}

export interface CrosshairsWidgetState extends vtkWidgetState {
  setPlaced(placed: boolean): boolean;
  getPlaced(): boolean;
  setIndexToWorld(indexToWorld: mat4): boolean;
  getIndexToWorld(): mat4;
  setWorldToIndex(worldToIndex: mat4): boolean;
  getWorldToIndex(): mat4;
  getHandle(): CrosshairsHandleWidgetState;
}

export default function generateState() {
  return vtkStateBuilder
    .createBuilder()
    .addField({
      name: 'placed',
      initialValue: false,
    })
    .addField({
      name: 'indexToWorld',
      initialValue: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    })
    .addField({
      name: 'worldToIndex',
      initialValue: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    })
    .addStateFromMixin({
      labels: ['handle'],
      mixins: ['origin', 'bounds'],
      name: 'handle',
      initialValues: {
        origin: null,
      },
    })
    .build();
}
