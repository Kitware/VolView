import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector4 } from '@kitware/vtk.js/types';

export interface vtkLabelMap extends vtkImageData {
  setLabelColor(label: number, color: Vector4): void;
  removeLabel(label: number): void;
  setColorMap(colorMap: Record<number, number[]>): boolean;
  getColorMap(): Record<number, number[]>;
}

export function newInstance(initialValues?: any): vtkLabelMap;

export declare const vtkLabelMap: {
  newInstance: typeof newInstance;
};
export default vtkLabelMap;
