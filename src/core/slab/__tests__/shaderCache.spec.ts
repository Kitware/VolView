import { expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkImageResliceMapper from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLImageResliceMapper from '@kitware/vtk.js/Rendering/OpenGL/ImageResliceMapper';
import vtkShaderCache from '@kitware/vtk.js/Rendering/OpenGL/ShaderCache';

it('reuses the slab shader program across plane and thickness edits', () => {
  const image = vtkImageData.newInstance();
  image.setDimensions(2, 2, 5);
  const scalars = vtkDataArray.newInstance({ values: new Float32Array(20) });
  image.getPointData().setScalars(scalars);
  const plane = vtkPlane.newInstance({ normal: [0, 0, 1], origin: [0, 0, 2] });
  const core = vtkImageResliceMapper.newInstance();
  core.setInputData(image);
  core.setSlicePlane(plane);
  core.setSlabThickness(4);
  const initialValues = {
    renderable: null,
    currentValidInputs: [{ imageData: image, inputIndex: 0 }],
  };
  const mapper = vtkOpenGLImageResliceMapper.newInstance(initialValues);
  mapper.setRenderable(core);
  const cache = vtkShaderCache.newInstance();
  const renderer = vtkRenderer.newInstance();
  const actor = vtkImageSlice.newInstance();
  const program = () => {
    mapper.updateResliceGeometry();
    const shaders = { Vertex: '', Fragment: '', Geometry: '' };
    mapper.getShaderTemplate(shaders, renderer, actor);
    mapper.replaceShaderPositionVC(shaders, renderer, actor);
    return cache.getShaderProgram(
      shaders.Vertex,
      shaders.Fragment,
      shaders.Geometry
    );
  };
  try {
    const slabProgram = program();
    for (let step = 1; step <= 20; step++) {
      plane.setOrigin(0, 0, 2 + step / 100);
      core.setSlabThickness(4 - step / 100);
      mapper.modified();
      expect(program()).toBe(slabProgram);
    }
    core.setSlabThickness(0);
    expect(program()).not.toBe(slabProgram);
    core.setSlabThickness(4);
    expect(program()).toBe(slabProgram);
  } finally {
    cache.releaseGraphicsResources();
    [mapper, core, plane, image, scalars, renderer, actor, cache].forEach(
      (object) => object.delete()
    );
  }
});
