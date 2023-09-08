import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import bounds from '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin';

import { POINTS_LABEL } from '@/src/vtk/ToolWidgetUtils/common';
import createPointState from '../ToolWidgetUtils/pointState';
import { watchState } from '../ToolWidgetUtils/utils';

function vtkRulerWidgetState(publicAPI: any, model: any) {
  const firstPoint = createPointState({
    id: model.id,
    store: model._store,
    key: 'firstPoint',
    visible: true,
  });
  const secondPoint = createPointState({
    id: model.id,
    store: model._store,
    key: 'secondPoint',
    visible: true,
  });

  watchState(publicAPI, firstPoint, () => publicAPI.modified());
  watchState(publicAPI, secondPoint, () => publicAPI.modified());

  model.labels = {
    [POINTS_LABEL]: [firstPoint, secondPoint],
  };

  publicAPI.getFirstPoint = () => firstPoint;
  publicAPI.getSecondPoint = () => secondPoint;
}

const defaultValues = (initialValues: any) => ({
  ...initialValues,
});

function _createRulerWidgetState(
  publicAPI: any,
  model: any,
  initialValues: any
) {
  Object.assign(model, defaultValues(initialValues));
  vtkWidgetState.extend(publicAPI, model, initialValues);
  bounds.extend(publicAPI, model);

  macro.get(publicAPI, model, ['id']);
  macro.moveToProtected(publicAPI, model, ['store']);

  vtkRulerWidgetState(publicAPI, model);
}

const createRulerWidgetState = macro.newInstance(
  _createRulerWidgetState,
  'vtkRulerWidgetState'
);

export default createRulerWidgetState;
