import macro from 'vtk.js/Sources/macro';
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction';
import vtkSliceRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SliceRepresentationProxy';
import ImagePropertyConstants from 'vtk.js/Sources/Rendering/Core/ImageProperty/Constants';

import vtkLabelMapTransformFilter from '../LabelMapTransformFilter';
import vtkRepresentationProxyTransformMixin from '../transformMixin';

const { InterpolationType } = ImagePropertyConstants;

// ----------------------------------------------------------------------------
// vtkLabelMapSliceRepProxy methods
// ----------------------------------------------------------------------------

function vtkLabelMapSliceRepProxy(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkLabelMapSliceRepProxy');

  let labelMapSub = null;

  model.property.setInterpolationType(InterpolationType.NEAREST);
  model.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(-2, -2);

  function updateTransferFunctions(labelmap) {
    const colorMap = labelmap.getColorMap();

    const cfun = vtkColorTransferFunction.newInstance();
    const ofun = vtkPiecewiseFunction.newInstance();

    Object.keys(colorMap).forEach((label) => {
      const l = Number(label);
      cfun.addRGBPoint(l, ...colorMap[label].slice(0, 3).map((c) => c / 255));
      ofun.addPoint(l, colorMap[label][3] / 255);
    });

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

  // apply mixin after we modify source dependencies
  vtkRepresentationProxyTransformMixin(vtkLabelMapTransformFilter)(
    publicAPI,
    model
  );
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Object methods
  vtkSliceRepresentationProxy.extend(publicAPI, model);

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
