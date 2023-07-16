import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import bounds from '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin';

import createPointState from './pointState';

export const PointsLabel = 'points';

function watchState(publicAPI: any, state: any, callback: () => {}) {
  let subscription = state.onModified(callback);
  const originalDelete = publicAPI.delete;
  publicAPI.delete = () => {
    subscription.unsubscribe();
    subscription = null;
    originalDelete();
  };
}

function vtkPolygonWidgetState(publicAPI: any, model: any) {
  const firstPoint = createPointState({
    id: model.id,
    store: model._store,
    key: 'polygon point',
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

  // model.labels = {
  //   [PointsLabel]: [firstPoint, secondPoint],
  // };

  publicAPI.getPoints = () => firstPoint;
  publicAPI.addPoint = () => secondPoint;
}

const defaultValues = (initialValues: any) => ({
  isPlaced: false,
  ...initialValues,
});

function _createPolygonWidgetState(
  publicAPI: any,
  model: any,
  initialValues: any
) {
  Object.assign(model, defaultValues(initialValues));
  vtkWidgetState.extend(publicAPI, model, initialValues);
  bounds.extend(publicAPI, model);

  macro.get(publicAPI, model, ['id']);
  macro.setGet(publicAPI, model, ['isPlaced']);
  macro.moveToProtected(publicAPI, model, ['store']);

  vtkPolygonWidgetState(publicAPI, model);
}

const createPolygonWidgetState = macro.newInstance(
  _createPolygonWidgetState,
  'vtkPolygonWidgetState'
);

export default createPolygonWidgetState;
