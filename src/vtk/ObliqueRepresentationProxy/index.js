import { vec3 } from 'gl-matrix';

import macro from '@kitware/vtk.js/macro';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource';
import vtkCutter from '@kitware/vtk.js/Filters/Core/Cutter';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';

function vtkObliqueRepresentationProxy(publicAPI, model) {
  model.classHierarchy.push('vtkObliqueRepresentationProxy');

  function transformPoints(points, transform) {
    const tmp = [0, 0, 0];
    for (let i = 0; i < points.length; i += 3) {
      const p = points.subarray(i, i + 3);
      if (transform.length === 9) {
        vec3.transformMat3(tmp, p, transform);
      } else {
        vec3.transformMat4(tmp, p, transform);
      }
      [p[0], p[1], p[2]] = tmp;
    }
  };

  function imageToCubePolyData(image, outPD) {
    // First create a cube polydata in the index-space of the image.
    const sext = image?.getSpatialExtent();

    if (sext) {
      model.cubeSource.setXLength(sext[1] - sext[0]);
      model.cubeSource.setYLength(sext[3] - sext[2]);
      model.cubeSource.setZLength(sext[5] - sext[4]);
    } else {
      model.cubeSource.setXLength(1);
      model.cubeSource.setYLength(1);
      model.cubeSource.setZLength(1);
    }

    model.cubeSource.setCenter(
      model.cubeSource.getXLength() / 2.0,
      model.cubeSource.getYLength() / 2.0,
      model.cubeSource.getZLength() / 2.0
    );

    model.cubeSource.update();
    const out = model.cubeSource.getOutputData();
    outPD.getPoints().setData(Float32Array.from(out.getPoints().getData()), 3);
    outPD.getPolys().setData(Uint32Array.from(out.getPolys().getData()), 1);

    // Now, transform the cube polydata points in-place
    // using the image's indexToWorld transformation.
    const points = outPD.getPoints().getData();
    transformPoints(points, image.getIndexToWorld());
  };

  model.cubeSource = vtkCubeSource.newInstance();
  model.cubePolyData = vtkPolyData.newInstance();
  model.cutter = vtkCutter.newInstance();
  model.cutter.setCutFunction(model.slicePlane);

  model.outline = {
    mapper: vtkMapper.newInstance(),
    actor: vtkActor.newInstance(),
    // property: this.actor.getProperty(),
  };
  model.outline.property = model.outline.actor.getProperty();
  model.outline.property.setLineWidth(5.0);

  model.outline.mapper.setInputConnection(model.cutter.getOutputPort());
  model.outline.actor.setMapper(model.outline.mapper);
  model.actors.push(model.outline.actor);

  function setInputData(inputDataset) {
    const inputImage = inputDataset;
    if (inputImage) {// && inputImage.getMTime() > publicAPI.getMTime()) {
      imageToCubePolyData(inputImage, model.cubePolyData);
      model.cutter.setInputData(model.cubePolyData);
    }
  }

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
  vtkResliceRepresentationProxy.extend(publicAPI, model);

  // Object specific methods
  vtkObliqueRepresentationProxy(publicAPI, model);

  // Proxyfy
  model.outlineProperty = model.outline.property;
  macro.proxyPropertyMapping(publicAPI, model, {
    outlineVisibility: { modelKey: 'outlineProperty', property: 'visibility' },
    outlineColor: { modelKey: 'outlineProperty', property: 'color' },
  });
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkObliqueRepresentationProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
