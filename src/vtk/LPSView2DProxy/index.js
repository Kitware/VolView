import macro from '@kitware/vtk.js/macro';
import vtkView2DProxy from '@kitware/vtk.js/Proxy/Core/View2DProxy';
import { applyLPSViewProxyBase } from '@/src/vtk/LPSViewProxyBase';

function vtkLPSView2DProxy(publicAPI, model) {
  model.classHierarchy.push('vtkLPSView2DProxy');
  const superClass = { ...publicAPI };

  // override; we will set the manipulator ourselves
  publicAPI.bindRepresentationToManipulator = () => {};

  // override reset camera to /just/ reset the camera
  publicAPI.resetCamera = (boundsToUse = null) => {
    model.renderer.resetCamera(boundsToUse);
  };

  // override addRepresentation
  publicAPI.addRepresentation = (rep) => {
    if (!rep) {
      return;
    }
    if (model.representations.indexOf(rep) === -1) {
      model.representations.push(rep);
      model.renderer.addViewProp(rep);
    }

    if (rep.setSlicingMode && model.slicingMode) {
      rep.setSlicingMode(model.slicingMode);
    }
  };

  publicAPI.setSlicingMode = (mode) => {
    model.axis = 'IJK'.indexOf(mode);
    if (superClass.setSlicingMode(mode) && mode) {
      let count = model.representations.length;
      while (count--) {
        const rep = model.representations[count];
        if (rep.setSlicingMode) {
          rep.setSlicingMode(mode);
        }
      }
    }
  };

  publicAPI.resizeToFit = (lookAxis, viewUpAxis, dims) => {
    const [w, h] = model.renderWindow.getViews()[0].getSize();
    let bw;
    let bh;
    if (lookAxis === 0 && viewUpAxis === 1) {
      [, bh, bw] = dims;
    } else if (lookAxis === 0 && viewUpAxis === 2) {
      [, bw, bh] = dims;
    } else if (lookAxis === 1 && viewUpAxis === 0) {
      [bh, , bw] = dims;
    } else if (lookAxis === 1 && viewUpAxis === 2) {
      [bw, , bh] = dims;
    } else if (lookAxis === 2 && viewUpAxis === 0) {
      [bh, bw] = dims;
    } else if (lookAxis === 2 && viewUpAxis === 1) {
      [bw, bh] = dims;
    }

    const viewAspect = w / h;
    const boundsAspect = bw / bh;
    let scale = 0;
    if (viewAspect >= boundsAspect) {
      scale = bh / 2;
    } else {
      scale = bw / 2 / viewAspect;
    }

    model.camera.setParallelScale(scale);
  };
}

const DEFAULT_VALUES = {
  slicingMode: null, // XYZIJK. Null means fallback to model.axis.
};

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues, DEFAULT_VALUES);

  // slicing mode overrides axis
  macro.setGet(publicAPI, model, ['slicingMode']);

  vtkView2DProxy.extend(publicAPI, model, initialValues);
  applyLPSViewProxyBase(publicAPI, model);

  vtkLPSView2DProxy(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkLPSView2DProxy');

export default { newInstance, extend };
