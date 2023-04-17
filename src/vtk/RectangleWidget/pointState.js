import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import visible from '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin';
import scale1 from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';

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

function _createPointState(publicAPI, model, { id, store, key }) {
  Object.assign(model, {
    id,
    _store: store,
    key,
  });
  vtkWidgetState.extend(publicAPI, model, {});
  visible.extend(publicAPI, model, { visible: true });
  scale1.extend(publicAPI, model, { scale1: 20 });

  const getTool = () => {
    if (model._store.isPlacingTool(model.id)) {
      return model._store.placingToolByID[model.id];
    }
    return model._store.toolByID[model.id];
  };

  const updateTool = (patch) => model._store.updateTool(model.id, patch);

  publicAPI.getOrigin = () => {
    return getTool()[model.key];
  };

  publicAPI.setOrigin = (xyz) => {
    updateTool({
      [model.key]: xyz,
    });
    publicAPI.modified();
  };

  watchStore(publicAPI, model._store, () => getTool()[model.key]);
}

const createPointState = macro.newInstance(
  _createPointState,
  'vtkRectangleWidgetStatePoint'
);

export default createPointState;
