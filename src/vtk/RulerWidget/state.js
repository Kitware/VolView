import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import bounds from '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin';

import createPointState from './pointState';

export const PointsLabel = 'points';

export const InteractionState = {
  PlacingFirst: 'PlacingFirst',
  PlacingSecond: 'PlacingSecond',
  Finalized: 'Finalized',
};

function watchState(publicAPI, state, callback) {
  let subscription = state.onModified(callback);
  const originalDelete = publicAPI.delete;
  publicAPI.delete = () => {
    subscription.unsubscribe();
    subscription = null;
    originalDelete();
  };
}

function vtkRulerWidgetState(publicAPI, model) {
  const firstPoint = createPointState({
    id: model.id,
    store: model._store,
    key: 'firstPoint',
  });
  const secondPoint = createPointState({
    id: model.id,
    store: model._store,
    key: 'secondPoint',
  });

  watchState(publicAPI, firstPoint, () => publicAPI.modified());
  watchState(publicAPI, secondPoint, () => publicAPI.modified());

  model.labels = {
    [PointsLabel]: [firstPoint, secondPoint],
  };

  publicAPI.getFirstPoint = () => firstPoint;
  publicAPI.getSecondPoint = () => secondPoint;

  model.interactionState =
    firstPoint.getOrigin() && secondPoint.getOrigin()
      ? InteractionState.Finalized
      : InteractionState.PlacingFirst;
}

function _createRulerWidgetState(publicAPI, model, initialValues) {
  Object.assign(model, initialValues);
  vtkWidgetState.extend(publicAPI, model, {});
  bounds.extend(publicAPI, model);

  macro.get(publicAPI, model, ['id']);
  macro.setGet(publicAPI, model, ['interactionState']);
  macro.moveToProtected(publicAPI, model, ['store']);

  vtkRulerWidgetState(publicAPI, model);
}

const createRulerWidgetState = macro.newInstance(
  _createRulerWidgetState,
  'vtkRulerWidgetState'
);

export default createRulerWidgetState;
