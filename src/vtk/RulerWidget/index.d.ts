import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { InteractionState } from './behavior';
import { useRulerStore } from '@/src/store/tools/rulers';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import { vtkAnnotationToolWidget } from '../ToolWidgetUtils/utils';

export { InteractionState } from './behavior';

export interface vtkRulerWidgetPointState extends vtkWidgetState {
  getVisible(): boolean;
}

export interface vtkRulerWidgetState extends vtkWidgetState {
  setIsPlaced(isPlaced: boolean): boolean;
  getIsPlaced(): boolean;
  getFirstPoint(): vtkRulerWidgetPointState;
  getSecondPoint(): vtkRulerWidgetPointState;
}

export interface vtkRulerViewWidget extends vtkAnnotationToolWidget {
  getWidgetState(): vtkRulerWidgetState;
}

export interface IRulerWidgetInitialValues {
  id: string;
  store: ReturnType<typeof useRulerStore>;
  isPlaced: boolean;
}

export interface vtkRulerWidget extends vtkAbstractWidgetFactory {
  getLength(): number;
  getWidgetState(): vtkRulerWidgetState;
}

function newInstance(initialValues: IRulerWidgetInitialValues): vtkRulerWidget;

export declare const vtkRulerWidget: {
  newInstance: typeof newInstance;
};
export default vtkRulerWidget;
