import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  allocateMask,
  reframeMaskScalars,
  setMaskScalars,
} from '../../../src/store/segmentMask';
import { maskScalars, type Extent3D } from '../../../src/types/segmentation';
import { segmentRenderMask } from '../../../src/components/vtk/segmentRenderMask';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import {
  SEGMENT_ACTOR_OPACITY,
  segmentOutlineTables,
} from '../../../src/components/vtk/segmentDisplay';

const renderer = vtkRenderer.newInstance();
const renderWindow = vtkRenderWindow.newInstance();
const view = vtkOpenGLRenderWindow.newInstance();
renderWindow.addRenderer(renderer);
renderWindow.addView(view);
const container = document.createElement('div');
container.style.cssText = 'width:200px;height:200px';
document.body.appendChild(container);
view.setContainer(container);
view.setSize(200, 200);
const params = new URLSearchParams(location.search);
const axis = Number(params.get('axis') ?? 2);
const scanEdge = params.has('scanEdge');
const parent = vtkImageData.newInstance();
const dimensions: [number, number, number] = [10, 10, 10];
dimensions[axis] = 1;
// Truncate only the high face of the first in-plane axis.
const edgeAxis = axis === 0 ? 1 : 0;
if (scanEdge) dimensions[edgeAxis] = 9;
parent.setDimensions(dimensions);
parent.setOrigin([12, -17, 23]);
const extent: Extent3D = [1, 8, 1, 8, 1, 8];
extent[axis * 2] = 0;
extent[axis * 2 + 1] = 0;
const source = allocateMask(parent, extent);
maskScalars(source).fill(1);
source.modified();
const mask = params.has('fullGrid')
  ? allocateMask(parent, parent.getExtent() as Extent3D)
  : segmentRenderMask(source, parent, extent, { axis: axis, index: 0 })!;
if (params.has('fullGrid')) {
  setMaskScalars(
    mask,
    reframeMaskScalars(
      maskScalars(source),
      extent,
      parent.getExtent() as Extent3D
    )
  );
}
const mapper = vtkImageMapper.newInstance();
mapper.setInputData(mask);
mapper.setSlicingMode(axis);
mapper.setSlice(0);
const actor = vtkImageSlice.newInstance();
actor.setMapper(mapper);
const property = actor.getProperty();
property.setInterpolationTypeToNearest();
property.setOpacity(SEGMENT_ACTOR_OPACITY);
property.setUseLookupTableScalarRange(true);
property.setUseLabelOutline(true);
property.setLabelOutlineThickness([3]);
property.setLabelOutlineOpacity([1]);
const colors = vtkColorTransferFunction.newInstance();
colors.addRGBPoint(0, 0, 0, 0);
colors.addRGBPoint(1, 1, 0, 0);
colors.addRGBPoint(2, 0, 0, 0);
const opacity = vtkPiecewiseFunction.newInstance();
opacity.addPoint(0, 0);
opacity.addPoint(1, 0.2);
opacity.addPoint(2, 0);
property.setRGBTransferFunction(0, colors);
property.setScalarOpacity(0, opacity);
renderer.addActor(actor);
const camera = renderer.getActiveCamera();
camera.setParallelProjection(true);
const focal: [number, number, number] = [3.5, 3.5, 3.5];
focal[axis] = 0;
const worldFocal = source.indexToWorld(focal);
const position = [...worldFocal] as [number, number, number];
position[axis] += 10;
camera.setPosition(...position);
camera.setFocalPoint(worldFocal[0], worldFocal[1], worldFocal[2]);
if (axis === 1) camera.setViewUp(0, 0, 1);
camera.setParallelScale(5);
renderer.resetCameraClippingRange();
// Keep the same actor while changing tables, as Reveal does.
function renderOutline(thickness = 3, outlineOpacity = 1) {
  const tables = segmentOutlineTables(
    [{ value: 1, name: 'Mask', visible: true, color: [255, 0, 0, 255] }],
    thickness,
    outlineOpacity
  );
  property.setLabelOutlineThickness(tables.thicknesses);
  property.setLabelOutlineOpacity(tables.opacities);
  renderWindow.render();
  const gl = view.get3DContext({});
  if (!gl) throw new Error('WebGL is required for the outline regression');
  const pixels = new Uint8Array(200 * 200 * 4);
  gl.readPixels(0, 0, 200, 200, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const red = (x: number, y: number) => pixels[(y * 200 + x) * 4];
  return {
    left: red(21, 100),
    right: red(178, 100),
    bottom: red(100, 21),
    top: red(100, 178),
    innerEdge: red(24, 100),
    center: red(100, 100),
    outside: red(19, 100),
  };
}

function editMask(value: number) {
  maskScalars(source).fill(value);
  source.modified();
  segmentRenderMask(source, parent, extent, { axis: axis, index: 0 });
  return renderOutline();
}

declare global {
  interface Window {
    renderOutline: typeof renderOutline;
    editMask: typeof editMask;
    outlineResult: ReturnType<typeof renderOutline>;
  }
}
window.renderOutline = renderOutline;
window.editMask = editMask;
window.outlineResult = renderOutline();
