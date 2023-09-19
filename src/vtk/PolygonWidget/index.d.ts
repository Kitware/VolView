import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  vtkAnnotationToolWidget,
  vtkAnnotationWidgetPointState,
} from '../ToolWidgetUtils/utils';

export interface vtkPolygonWidgetPointState
  extends vtkAnnotationWidgetPointState {}

export interface vtkPolygonWidgetState extends vtkWidgetState {
  getMoveHandle(): any;
  clearHandles(): void;
  getPlacing(): boolean;
  setPlacing(is: boolean): void;
  getFinishable(): boolean;
  setFinishable(is: boolean): void;
}

export interface vtkPolygonViewWidget extends vtkAnnotationToolWidget {
  getWidgetState(): vtkPolygonWidgetState;
}

export interface IPolygonWidgetInitialValues {
  id: string;
  store: ReturnType<typeof usePolygonStore>;
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
