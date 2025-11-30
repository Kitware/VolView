import vtkAbstractMapper from '@kitware/vtk.js/Rendering/Core/AbstractMapper';
import vtkProp from '@kitware/vtk.js/Rendering/Core/Prop';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { vtkObject } from '@kitware/vtk.js/interfaces';

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

export type vtkPropWithMapperProperty<
  M extends vtkAbstractMapper = vtkAbstractMapper,
  P extends vtkObject = vtkObject,
> = vtkProp & {
  setMapper(m: M): void;
  getProperty(): P;
};

export interface Representation<
  Actor extends vtkPropWithMapperProperty,
  Mapper extends vtkAbstractMapper,
> {
  actor: Actor;
  mapper: Mapper;
  property: ReturnType<Actor['getProperty']>;
}
