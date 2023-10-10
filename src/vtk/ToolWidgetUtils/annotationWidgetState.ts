import { useAnnotationToolStore } from '@/src/store/tools';
import { IAnnotationToolWidgetInitialValues } from '@/src/vtk/ToolWidgetUtils/types';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import macro from '@kitware/vtk.js/macros';

function extend(
  publicAPI: any,
  model: any,
  initialValues: IAnnotationToolWidgetInitialValues
) {
  vtkWidgetState.extend(publicAPI, model, initialValues);
  macro.get(publicAPI, model, ['id', 'toolType']);

  publicAPI.getStore = () => useAnnotationToolStore(model.toolType);
}

export declare const vtkAnnotationWidgetState: {
  extend: typeof extend;
};

export default { extend };
