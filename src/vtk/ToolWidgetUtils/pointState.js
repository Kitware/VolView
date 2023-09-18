import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import visibleMixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin';
import scale1Mixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';
import { ANNOTATION_TOOL_HANDLE_RADIUS } from '@/src/constants';

const PIXEL_SIZE = ANNOTATION_TOOL_HANDLE_RADIUS * 2;

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

  const updateTool = (patch) => model._store.updateTool(model.id, patch);

  publicAPI.getOrigin = () => {
    return getTool()?.[model.key];
  };

  publicAPI.setOrigin = (xyz) => {
    updateTool({
      [model.key]: xyz,
    });
    publicAPI.modified();
  };

  watchStore(publicAPI, model._store, () => getTool()?.[model.key]);
}

const createPointState = macro.newInstance(
  _createPointState,
  'vtkPointWidgetState'
);

export default createPointState;
