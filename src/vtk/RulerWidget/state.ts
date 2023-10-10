import macro from '@kitware/vtk.js/macros';
import bounds from '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin';
import vtkAnnotationWidgetState from '@/src/vtk/ToolWidgetUtils/annotationWidgetState';
import { AnnotationToolType } from '@/src/store/tools/types';

import createPointState from '../ToolWidgetUtils/pointState';
import { watchState } from '../ToolWidgetUtils/utils';

export const PointsLabel = 'points';

function vtkRulerWidgetState(publicAPI: any, model: any) {
  const firstPoint = createPointState({
    id: model.id,
    store: publicAPI.getStore(),
    key: 'firstPoint',
    visible: true,
  });
  const secondPoint = createPointState({
    id: model.id,
    store: publicAPI.getStore(),
    key: 'secondPoint',
    visible: true,
  });

  watchState(publicAPI, firstPoint, () => publicAPI.modified());
  watchState(publicAPI, secondPoint, () => publicAPI.modified());

  model.labels = {
    [PointsLabel]: [firstPoint, secondPoint],
  };

  publicAPI.getFirstPoint = () => firstPoint;
  publicAPI.getSecondPoint = () => secondPoint;
}

const defaultValues = (initialValues: any) => ({
  toolType: AnnotationToolType.Ruler,
  isPlaced: false,
  ...initialValues,
});

function _createRulerWidgetState(
  publicAPI: any,
  model: any,
  initialValues: any
) {
  Object.assign(model, defaultValues(initialValues));
  vtkAnnotationWidgetState.extend(publicAPI, model, initialValues);
  bounds.extend(publicAPI, model);

  macro.setGet(publicAPI, model, ['isPlaced']);

  vtkRulerWidgetState(publicAPI, model);
}

const createRulerWidgetState = macro.newInstance(
  _createRulerWidgetState,
  'vtkRulerWidgetState'
);

export default createRulerWidgetState;
