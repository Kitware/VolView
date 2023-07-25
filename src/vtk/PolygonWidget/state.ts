import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import bounds from '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin';
import visibleMixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin';
import scale1Mixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';
import { Vector3 } from '@kitware/vtk.js/types';

import createPointState from './pointState';

export const MoveHandleLabel = 'moveHandle';
export const HandlesLabel = 'handles';

const PIXEL_SIZE = 20;

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
  const moveHandle = createPointState({
    id: model.id,
    store: model._store,
    key: 'movePoint',
    visible: true,
  });
  watchState(publicAPI, moveHandle, () => publicAPI.modified());

  publicAPI.getMoveHandle = () => moveHandle;

  const getTool = () => model._store.toolByID[model.id];

  model.handles = [];

  publicAPI.getHandles = () => model.handles;

  publicAPI.addHandle = (addPoint = true) => {
    const index = model.handles.length;
    const handleModel = { index };
    const handlePublicAPI = {
      getOrigin: () => getTool()?.points[index],
      setOrigin: (xyz: Vector3) => {
        getTool().points[index] = xyz;
        publicAPI.modified();
      },
    };
    vtkWidgetState.extend(handlePublicAPI, handleModel, {});
    visibleMixin.extend(handlePublicAPI, handleModel, { visible: true });
    scale1Mixin.extend(handlePublicAPI, handleModel, { scale1: PIXEL_SIZE });

    if (addPoint) getTool().points.push([0, 0, 0]);

    publicAPI.bindState(handlePublicAPI, [HandlesLabel]);
    model.handles.push(handlePublicAPI);
    publicAPI.modified();
    return handlePublicAPI;
  };

  publicAPI.removeHandle = (removeIndex: number) => {
    const instance = model.handles[removeIndex];
    if (instance) {
      publicAPI.unbindState(instance);
    }
    model.handles.splice(removeIndex, 1);

    getTool().points.splice(removeIndex, 1);

    publicAPI.modified();
  };

  publicAPI.clearHandles = () => {
    while (model.handles.length) {
      const instance = model.handles.pop();
      if (instance) {
        publicAPI.unbindState(instance);
      }
    }

    // Tool does not exist if loading new image
    const tool = getTool();
    if (tool) tool.points = [];

    publicAPI.modified();
  };

  model.labels = {
    [MoveHandleLabel]: [moveHandle],
    [HandlesLabel]: [model.handles],
  };

  publicAPI.getPlacing = () => getTool().placing;
  publicAPI.setPlacing = (placing: boolean) => {
    getTool().placing = placing;
  };

  // After deserialize, initialize handles
  getTool().points.forEach((point: Vector3) => {
    const handle = publicAPI.addHandle(false);
    handle.setOrigin(point);
  });
}

const defaultValues = (initialValues: any) => ({
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
  macro.moveToProtected(publicAPI, model, ['store']);

  vtkPolygonWidgetState(publicAPI, model);
}

const createPolygonWidgetState = macro.newInstance(
  _createPolygonWidgetState,
  'vtkPolygonWidgetState'
);

export default createPolygonWidgetState;
