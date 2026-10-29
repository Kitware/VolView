import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';

const size = 200;
const renderer = vtkRenderer.newInstance({ background: [0, 0, 0] });
const renderWindow = vtkRenderWindow.newInstance();
const view = vtkOpenGLRenderWindow.newInstance();
renderWindow.addRenderer(renderer);
renderWindow.addView(view);
view.setContainer(document.querySelector<HTMLDivElement>('#view')!);
view.setSize(size, size);
const interactor = vtkRenderWindowInteractor.newInstance();
interactor.setView(view);
interactor.enable();

const image = vtkImageData.newInstance();
image.setDimensions(8, 8, 8);
const values = new Uint8Array(8 * 8 * 8).fill(255);
const scalars = vtkDataArray.newInstance({
  name: 'Volume',
  numberOfComponents: 1,
  values,
});
image.getPointData().setScalars(scalars);
const mapper = vtkVolumeMapper.newInstance();
mapper.setInputData(image);
mapper.setAutoAdjustSampleDistances(false);
mapper.setSampleDistance(0.5);
const actor = vtkVolume.newInstance();
actor.setMapper(mapper);
const property = actor.getProperty();
property.setInterpolationTypeToNearest();
property.setShade(false);
property.setScalarOpacityUnitDistance(0, 1);
const colors = vtkColorTransferFunction.newInstance();
colors.addRGBPoint(0, 0, 0, 0);
colors.addRGBPoint(128, 0, 0, 1);
colors.addRGBPoint(255, 1, 0, 0);
const opacity = vtkPiecewiseFunction.newInstance();
opacity.addPoint(0, 0);
opacity.addPoint(128, 1);
opacity.addPoint(255, 1);
property.setRGBTransferFunction(0, colors);
property.setScalarOpacity(0, opacity);
renderer.addVolume(actor);
const camera = renderer.getActiveCamera();
camera.setParallelProjection(true);
camera.setPosition(3.5, 3.5, 20);
camera.setFocalPoint(3.5, 3.5, 3.5);
camera.setViewUp(0, 1, 0);
camera.setParallelScale(5);
renderer.resetCameraClippingRange();

function render() {
  const status = document.querySelector<HTMLOutputElement>('#render-status')!;
  try {
    renderWindow.render();
    const gl = view.get3DContext({});
    if (!gl) throw new Error('WebGL is required for volume texture rendering');
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const pixel = (x: number, y: number) =>
      Array.from(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
    document.querySelector('#render-pixels')!.textContent = JSON.stringify({
      center: pixel(100, 100),
      edge: pixel(50, 100),
      outside: pixel(10, 10),
    });
    status.textContent = 'Rendered';
  } catch (error) {
    status.textContent = String(error);
    throw error;
  }
}

document.querySelector('#update-volume')!.addEventListener('click', () => {
  for (let z = 0; z < 8; z++)
    for (let y = 2; y <= 5; y++)
      for (let x = 2; x <= 5; x++) values[(z * 8 + y) * 8 + x] = 128;
  scalars.modified();
  image.modified();
  property.setUpdatedExtents([[2, 5, 2, 5, 0, 7]]);
  render();
});

property.setUpdatedExtents([[0, 1, 0, 1, 0, 1]]);
render();
