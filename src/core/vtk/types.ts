import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';

export type VtkObjectConstructor<T> = {
  newInstance(props?: any): T;
};

export interface RequestRenderOptions {
  immediate?: boolean;
}

export interface View {
  renderWindow: vtkRenderWindow;
  renderer: vtkRenderer;
  interactor: vtkRenderWindowInteractor;
  renderWindowView: vtkOpenGLRenderWindow;
  widgetManager: vtkWidgetManager;
  requestRender(opts?: RequestRenderOptions): void;
}
