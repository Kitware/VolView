import macro from '@kitware/vtk.js/macro';

import vtkGeometryRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/GeometryRepresentationProxy';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';
import vtkImageDataOutlineFilter from '@kitware/vtk.js/Filters/General/ImageDataOutlineFilter';

function vtkMultiSliceRepresentationProxy(publicAPI, model) {
  model.classHierarchy.push('vtkMultiSliceRepresentationProxy');

  // setup image outline
  model.outlineFilter = vtkImageDataOutlineFilter.newInstance();
  model.outlineFilter.setGenerateFaces(false);
  model.outlineFilter.setGenerateLines(true);

  // clear previous dependencies (mapper)
  model.sourceDependencies.length = 0;
  model.sourceDependencies.push(model.outlineFilter);
  publicAPI.getMapper().setInputConnection(model.outlineFilter.getOutputPort());

  // array of slices
  model.slices = [
    vtkResliceRepresentationProxy.newInstance(),
    vtkResliceRepresentationProxy.newInstance(),
    vtkResliceRepresentationProxy.newInstance(),
  ];

  model.slices.forEach((sliceRep) => {
    // add all actors to the composite representation:
    sliceRep.getActors().forEach((sliceRepActor) => {
      model.actors.push(sliceRepActor);
    });
  });

  publicAPI.setDataOutlineProperties = (props) => {
    if (props.lineWidth) {
      publicAPI.setLineWidth(props.lineWidth);
    }

    if (props.color) {
      publicAPI.setColor(props.color);
    }

    if (props.opacity) {
      publicAPI.setOpacity(props.opacity);
    }
  };

  publicAPI.setSliceOutlineProperties = (props) => {
    if (props.length === model.slices.length) {
      model.slices.forEach((rep, idx) => {
        if (props[idx].lineWidth) {
          rep.setOutlineLineWidth(props[idx].lineWidth);
        }
        if (props[idx].color) {
          rep.setOutlineColor(props[idx].color);
        }
        rep.setOutlineVisibility(true);
      });
    }
  };

  publicAPI.setPlanes = (planes) => {
    if (planes.length === model.slices.length) {
      for (let i = 0; i < planes.length; ++i) {
        model.slices[i].getSlicePlane().setNormal(planes[i].normal);
        model.slices[i].getSlicePlane().setOrigin(planes[i].origin);
      }
    }
  };

  const _setInput = publicAPI.setInput;
  publicAPI.setInput = (source) => {
    _setInput(source);
    model.slices.forEach((sliceRep) => sliceRep.setInput(source));
  };

  publicAPI.setWindowWidth = (width) =>
    model.slices.forEach((r) => r.setWindowWidth(width));
  publicAPI.setWindowLevel = (level) =>
    model.slices.forEach((r) => r.setWindowLevel(level));
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);
  vtkGeometryRepresentationProxy.extend(publicAPI, model);
  vtkMultiSliceRepresentationProxy(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkMultiSliceRepresentationProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
