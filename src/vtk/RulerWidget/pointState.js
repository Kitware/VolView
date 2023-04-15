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

  const getRuler = () => {
    if (model._store.isPlacingRuler(model.id)) {
      return model._store.placingRulerByID[model.id];
    }
    return model._store.rulerByID[model.id];
  };

  const updateRuler = (patch) => model._store.updateRuler(model.id, patch);

  publicAPI.getOrigin = () => {
    return getRuler()[model.key];
  };

  publicAPI.setOrigin = (xyz) => {
    updateRuler({
      [model.key]: xyz,
    });
    publicAPI.modified();
  };

  watchStore(publicAPI, model._store, () => getRuler()[model.key]);
}

const createPointState = macro.newInstance(
  _createPointState,
  'vtkRulerWidgetStatePoint'
);

export default createPointState;
