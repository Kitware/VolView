import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { RectangleWidgetState } from './state';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import vtkRulerWidget, {
  IRulerWidgetInitialValues,
  vtkRulerViewWidget,
  vtkRulerWidgetPointState,
} from '../RulerWidget';

export { InteractionState } from '../RulerWidget';

export interface vtkRectangleWidgetPointState extends vtkRulerWidgetPointState {}

export interface vtkRectangleWidgetState extends vtkRulerWidgetState {}

export interface vtkRectangleViewWidget extends vtkRulerViewWidget {}

export interface IRectangleWidgetInitialValues extends IRulerWidgetInitialValues {}

export interface vtkRectangleWidget extends vtkRulerWidget {}

function newInstance(
  initialValues: IRectangleWidgetInitialValues
): vtkRectangleWidget;

export declare const vtkRectangleWidget: {
  newInstance: typeof newInstance;
};

export default vtkRectangleWidget;
