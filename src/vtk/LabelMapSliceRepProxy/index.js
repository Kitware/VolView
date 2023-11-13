import macro from '@kitware/vtk.js/macro';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import ImagePropertyConstants from '@kitware/vtk.js/Rendering/Core/ImageProperty/Constants';

import vtkIJKSliceRepresentationProxy from '../IJKSliceRepresentationProxy';

const { InterpolationType } = ImagePropertyConstants;

// ----------------------------------------------------------------------------
// vtkLabelMapSliceRepProxy methods
// ----------------------------------------------------------------------------

function vtkLabelMapSliceRepProxy(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkLabelMapSliceRepProxy');

  let labelMapSub = null;

  // needed for vtk.js >= 23.0.0
  model.property.setUseLookupTableScalarRange(true);
  model.property.setInterpolationType(InterpolationType.NEAREST);
  model.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(-2, -2);

  let cachedSegments = null;

  function updateTransferFunctions(labelmap) {
    const segments = labelmap.getSegments();
    if (segments === cachedSegments) {
      return;
    }
    // Cache the colormap using ref equality. This will
    // avoid updating the colormap unnecessarily.
    cachedSegments = segments;

    const cfun = vtkColorTransferFunction.newInstance();
    const ofun = vtkPiecewiseFunction.newInstance();

    let maxValue = 0;

    segments.forEach((segment) => {
      const r = segment.color[0] || 0;
      const g = segment.color[1] || 0;
      const b = segment.color[2] || 0;
      const a = segment.color[3] || 0;
      cfun.addRGBPoint(segment.value, r / 255, g / 255, b / 255);
      ofun.addPoint(segment.value, a / 255);

      if (segment.value > maxValue) {
        maxValue = segment.value;
      }
    });

    // add min/max values of the colormap range
    cfun.addRGBPoint(0, 0, 0, 0);
    ofun.addPoint(0, 0);
    cfun.addRGBPoint(maxValue + 1, 0, 0, 0);
    ofun.addPoint(maxValue + 1, 0);

    model.property.setRGBTransferFunction(cfun);
    model.property.setScalarOpacity(ofun);
  }

  function setInputData(labelmap) {
    if (labelMapSub) {
      labelMapSub.unsubscribe();
      labelMapSub = null;
    }

    if (labelmap) {
      labelMapSub = labelmap.onModified(() =>
        updateTransferFunctions(labelmap)
      );
      updateTransferFunctions(labelmap);
    }
  }

  // override because we manage our own color/opacity functions
  publicAPI.setColorBy = () => {};

  publicAPI.delete = macro.chain(publicAPI.delete, () => {
    if (labelMapSub) {
      labelMapSub.unsubscribe();
      labelMapSub = null;
    }
  });

  // Keep things updated
  model.sourceDependencies.push({ setInputData });
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Object methods
  vtkIJKSliceRepresentationProxy.extend(publicAPI, model);

  // Object specific methods
  vtkLabelMapSliceRepProxy(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkLabelMapSliceRepProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
