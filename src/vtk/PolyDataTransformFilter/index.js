import { mat4, vec3 } from 'gl-matrix';
import macro from 'vtk.js/Sources/macro';
import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
import vtkPoints from 'vtk.js/Sources/Common/Core/Points';

const { vtkErrorMacro } = macro;

// ----------------------------------------------------------------------------
// vtkPolyDataTransformFilter methods
// ----------------------------------------------------------------------------

function vtkPolyDataTransformFilter(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkPolyDataTransformFilter');

  // --------------------------------------------------------------------------

  publicAPI.requestData = (inData, outData) => {
    // implement requestData
    const input = inData[0];

    if (!input) {
      return;
    }

    const points = input.getPoints();

    if (!points || points.getNumberOfPoints() === 0) {
      vtkErrorMacro('No points from input');
      return;
    }

    const outpd = vtkPolyData.newInstance();
    outpd.shallowCopy(input);

    // skip using getTuple() for perf
    const ncomp = points.getNumberOfComponents();
    if (ncomp !== 3) {
      vtkErrorMacro('Polydata points are not in 3D space');
      return;
    }

    const npts = points.getNumberOfPoints();
    const inValues = points.getData();
    const outValues = new inValues.constructor(inValues.length);

    const outPoints = vtkPoints.newInstance();
    outPoints.shallowCopy(points);
    outPoints.setData(outValues);
    outpd.setPoints(outPoints);

    for (let i = 0; i < npts; i += 1) {
      const idx = i * ncomp;
      const pt = [inValues[idx], inValues[idx + 1], inValues[idx + 2]];
      vec3.transformMat4(pt, pt, model.transform);
      outValues.set(pt, idx);
    }

    outData[0] = outpd;
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  transform: mat4.create(),
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Make this a VTK object
  macro.obj(publicAPI, model);

  // Also make it an algorithm with one input and one output
  macro.algo(publicAPI, model, 1, 1);

  macro.setGetArray(publicAPI, model, ['transform'], 16);

  // Object specific methods
  vtkPolyDataTransformFilter(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkPolyDataTransformFilter'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
