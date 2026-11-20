import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { allocateMask, setMaskScalars } from '@/src/segmentation/masks/storage';
import { maskScalars } from '@/src/segmentation/model';
import { reframeMaskScalars, type Extent3D } from '@/src/segmentation/geometry';
import {
  composeSlice,
  slicePlaneExtent,
} from '@/src/segmentation/rendering/sliceComposition';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import {
  SEGMENT_ACTOR_OPACITY,
  labelLookupTables,
  type LabelmapAppearance,
} from '@/src/segmentation/rendering/display';

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
const axis = Number(params.get('axis') ?? 2) as 0 | 1 | 2;
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
const sourceMask = () => ({ id: 'mask', extent, scalars: maskScalars(source) });
const planeExtent = slicePlaneExtent(
  [extent],
  parent.getExtent() as Extent3D,
  axis,
  0
)!;
// Recomposes into the plane's own buffer, as a slice view does per stroke.
function composePlane(image?: ReturnType<typeof allocateMask>) {
  const reuse = image ? [maskScalars(image)] : [];
  const [plane] = composeSlice([sourceMask()], planeExtent, reuse);
  const values = plane?.values ?? new Uint8Array(maskScalars(image!).length);
  const target = image ?? allocateMask(parent, planeExtent);
  if (values !== maskScalars(target)) setMaskScalars(target, values);
  target.getPointData().getScalars().dataChange();
  target.modified();
  return target;
}
const mask = params.has('fullGrid')
  ? allocateMask(parent, parent.getExtent() as Extent3D)
  : composePlane();
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
const opacity = vtkPiecewiseFunction.newInstance();
property.setRGBTransferFunction(0, colors);
property.setScalarOpacity(0, opacity);
function applyLabels(labels: LabelmapAppearance[]) {
  const tables = labelLookupTables(labels);
  colors.setNodes(tables.colorNodes);
  opacity.setNodes(tables.opacityNodes);
  property.setLabelOutlineThickness(tables.thicknesses);
  property.setLabelOutlineOpacity(tables.opacities);
}
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
const gl = () => {
  const context = view.get3DContext({});
  if (!context) throw new Error('WebGL is required for the outline regression');
  return context;
};
function readPixels() {
  renderWindow.render();
  const pixels = new Uint8Array(200 * 200 * 4);
  gl().readPixels(0, 0, 200, 200, gl().RGBA, gl().UNSIGNED_BYTE, pixels);
  return (x: number, y: number) =>
    Array.from(pixels.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3));
}
// Keep the same actor while changing tables, as Reveal does.
function renderOutline(thickness = 3, outlineOpacity = 1) {
  applyLabels([
    {
      value: 1,
      color: [255, 0, 0],
      fillOpacity: 0.2,
      outlineThickness: thickness,
      outlineOpacity,
    },
  ]);
  const pixel = readPixels();
  const red = (x: number, y: number) => pixel(x, y)[0];
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
  if (composePlane(mask) !== mask) throw new Error('Plane was reallocated');
  return renderOutline();
}

// Every byte label, one voxel each and alternating colors, so a lookup that
// blended in a neighbor's entry would show in the red channel.
const labelColor = (value: number) => [
  value % 2 ? 255 : 0,
  (value * 97) % 256,
  value,
];
function renderAllLabels() {
  const side = 16;
  const grid = vtkImageData.newInstance();
  grid.setDimensions([side, side, 1]);
  const masks = Array.from({ length: 255 }, (_, index) => {
    const voxel: Extent3D = [
      index % side,
      index % side,
      Math.floor(index / side),
      Math.floor(index / side),
      0,
      0,
    ];
    return { id: `${index}`, extent: voxel, scalars: new Uint8Array([1]) };
  });
  const plane = slicePlaneExtent(
    masks.map((entry) => entry.extent),
    grid.getExtent() as Extent3D,
    2,
    0
  )!;
  const planes = composeSlice(masks, plane);
  const image = allocateMask(grid, plane);
  setMaskScalars(image, planes[0].values);
  mapper.setInputData(image);
  mapper.setSlicingMode(2);
  applyLabels(
    planes[0].segmentIds.map((_, index) => ({
      value: index + 1,
      color: labelColor(index + 1),
      fillOpacity: 1,
      outlineThickness: 0,
      outlineOpacity: 0,
    }))
  );
  camera.setPosition(7.5, 7.5, 10);
  camera.setFocalPoint(7.5, 7.5, 0);
  camera.setViewUp(0, 1, 0);
  camera.setParallelScale(8);
  renderer.resetCameraClippingRange();
  const pixel = readPixels();
  const toPixel = (index: number) => Math.floor((index + 0.5) * 12.5);
  return {
    planes: planes.length,
    mismatches: planes[0].segmentIds.flatMap((id, index) => {
      const n = Number(id);
      const seen = pixel(toPixel(n % side), toPixel(Math.floor(n / side)));
      const expected = labelColor(index + 1);
      return seen.some((channel, c) => Math.abs(channel - expected[c]) > 1)
        ? [{ label: index + 1, seen, expected }]
        : [];
    }),
  };
}

declare global {
  interface Window {
    renderOutline: typeof renderOutline;
    renderAllLabels: typeof renderAllLabels;
    editMask: typeof editMask;
    outlineResult: ReturnType<typeof renderOutline>;
  }
}
window.renderOutline = renderOutline;
window.editMask = editMask;
window.renderAllLabels = renderAllLabels;
window.outlineResult = renderOutline();
