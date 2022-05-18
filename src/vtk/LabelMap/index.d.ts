import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Vector4 } from '@kitware/vtk.js/types';

export interface vtkLabelMap extends vtkImageData {
  setLabelColor(label: number, color: Vector4): void;
  removeLabel(label: number): void;
}

export function newInstance(initialValues?: any): vtkLabelMap;

export declare const vtkLabelMap: {
  newInstance: typeof newInstance;
};
export default vtkLabelMap;
