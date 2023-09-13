import macro from '@kitware/vtk.js/macros';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import visibleMixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin';
import scale1Mixin from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';
import { HANDLE_PIXEL_SIZE } from '@/src/vtk/ToolWidgetUtils/common';
import { watchStore } from '@/src/vtk/ToolWidgetUtils/utils';

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
  scale1Mixin.extend(publicAPI, model, { scale1: HANDLE_PIXEL_SIZE });

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
