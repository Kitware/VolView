import macro from '@kitware/vtk.js/macro';

import vtkRulerWidget from '../RulerWidget';

export { InteractionState } from '../RulerWidget/behavior';
// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

function vtkRectangleWidget(publicAPI, model) {
  model.classHierarchy.push('vtkRectangleWidget');
}

// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  const { store: toolStore, ...rest } = initialValues;

  const rulerStore = {
    ...toolStore,
    rulerByID: toolStore.toolByID,
    updateRuler: toolStore.updateTool,
  };

  vtkRulerWidget.extend(publicAPI, model, { store: rulerStore, ...rest });

  vtkRectangleWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkRectangleWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
