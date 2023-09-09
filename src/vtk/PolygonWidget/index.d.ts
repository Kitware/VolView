import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { vtkAnnotationToolWidget } from '../ToolWidgetUtils/utils';
import { Vector3 } from '@kitware/vtk.js/types';

export interface vtkPolygonWidgetPointState extends vtkWidgetState {
  getVisible(): boolean;
  getOrigin(): Vector3 | null;
  getScale1(): number;
}

export interface vtkPolygonWidgetState extends vtkWidgetState {
  getHandles(): vtkPolygonWidgetPointState[];
  getHandleList(): vtkPolygonWidgetPointState[];
  getMoveHandle(): vtkPolygonWidgetPointState;
  clearHandles(): void;
  clearHandleList(): void;
  getPlacing(): boolean;
  setPlacing(is: boolean): void;
  getFinishable(): boolean;
  setFinishable(is: boolean): void;
}

export interface vtkPolygonViewWidget extends vtkAnnotationToolWidget {
  getWidgetState(): vtkPolygonWidgetState;
  reset(): void;
}

export interface IPolygonWidgetInitialValues {
  widgetState?: vtkPolygonWidgetState;
}

export interface vtkPolygonWidget extends vtkAbstractWidgetFactory {
  getLength(): number;
  getWidgetState(): vtkPolygonWidgetState;
}

function newInstance(
  initialValues: IPolygonWidgetInitialValues
): vtkPolygonWidget;

export declare const vtkPolygonWidget: {
  newInstance: typeof newInstance;
};
export default vtkPolygonWidget;
