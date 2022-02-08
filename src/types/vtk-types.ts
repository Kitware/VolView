import { vtkAlgorithm, vtkObject } from '@kitware/vtk.js/interfaces';

export interface vtkClass {
  newInstance: () => vtkObject;
  extend: (publiAPI: any, model: any) => void;
}

export interface vtkReader extends vtkObject, vtkAlgorithm {
  parseAsArrayBuffer: (ab: ArrayBufferLike) => void;
  parseAsText: (text: string) => void;
}
