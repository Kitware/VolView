import { IBrushStencil } from '@/src/core/tools/paint/brush';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkStateBuilder from '@kitware/vtk.js/Widgets/Core/StateBuilder';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';

export interface PaintPointWidgetState extends vtkWidgetState {
  setOrigin(origin: Vector3 | null): boolean;
  getOrigin(): Vector3 | null;
  setScale1(scale: number): boolean;
  getScale1(): number;
  setVisible(visible: boolean): boolean;
  getVisible(): boolean;
  setColor(color: number): boolean;
  getColor(): number;
}

export interface PaintWidgetState extends vtkWidgetState {
  getBrush(): PaintPointWidgetState;
  getStencil(): IBrushStencil;
  setStencil(stencil: IBrushStencil): boolean;
}

export default function generateState() {
  return vtkStateBuilder
    .createBuilder()
    .addStateFromMixin({
      labels: ['brush'],
      name: 'brush',
      mixins: ['origin', 'scale1', 'visible', 'color'],
      initialValues: {
        scale1: 1,
        origin: null,
        visible: true,
      },
    })
    .addField({
      name: 'stencil',
      initialValue: null,
    })
    .build() as PaintWidgetState;
}
