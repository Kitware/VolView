import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import visibleMixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin';
import scale1Mixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';

const PIXEL_SIZE = 20;

function watchStore(publicAPI, store, getter, cmp) {
  let cached = getter();
  const unsubscribe = store.$subscribe(() => {
    const val = getter();
    if (cmp ? cmp(cached, val) : cached !== val) {
      cached = val;
      publicAPI.modified();
    }
  });

  const originalDelete = publicAPI.delete;
  publicAPI.delete = () => {
    unsubscribe();
    originalDelete();
  };
}

function _createPointState(
  publicAPI,
  model,
  { id, store, key, visible = true }
) {
  Object.assign(model, {
    id,
    _store: store,
    key,
  });
  vtkWidgetState.extend(publicAPI, model, {});
  visibleMixin.extend(publicAPI, model, { visible });
  scale1Mixin.extend(publicAPI, model, { scale1: PIXEL_SIZE });

  const getTool = () => {
    return model._store.toolByID[model.id];
  };

  const updatePolygon = (patch) => model._store.updateTool(model.id, patch);

  publicAPI.getOrigin = () => {
    return getTool()?.[model.key];
  };

  publicAPI.setOrigin = (xyz) => {
    updatePolygon({
      [model.key]: xyz,
    });
    publicAPI.modified();
  };

  watchStore(publicAPI, model._store, () => getTool()?.[model.key]);
}

const createPointState = macro.newInstance(
  _createPointState,
  'vtkPolygonWidgetStatePoint'
);

export default createPointState;
