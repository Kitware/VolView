import { vtkAlgorithm, vtkObject } from '@kitware/vtk.js/interfaces';
import vtkDataSet from '@kitware/vtk.js/Common/DataModel/DataSet';
import { View } from '@/src/core/vtk/types';
import vtkInteractorStyle from '@kitware/vtk.js/Rendering/Core/InteractorStyle';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';

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

export interface VtkViewApi extends View {
  interactorStyle?: vtkInteractorStyle;
  resetCamera(): void;
}

export interface VtkRenderWindowParentApi {
  renderWindow: vtkRenderWindow;
  renderWindowView: vtkOpenGLRenderWindow;
}
