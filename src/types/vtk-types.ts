import { vtkAlgorithm, vtkObject } from '@kitware/vtk.js/interfaces';
import vtkDataSet from '@kitware/vtk.js/Common/DataModel/DataSet';
import vtkLPSView2DProxy from '../vtk/LPSView2DProxy';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';

export interface vtkClass {
  newInstance: () => vtkObject;
  extend: (publiAPI: any, model: any) => void;
}

export interface vtkReader extends vtkObject, vtkAlgorithm {
  parseAsArrayBuffer: (ab: ArrayBufferLike) => void;
  parseAsText: (text: string) => void;
}

export interface vtkWriter extends vtkObject {
  write: (data: vtkDataSet) => any;
}

export type vtkLPSViewProxy = vtkLPSView2DProxy | vtkLPSView3DProxy;
