import { View } from '@/src/core/vtk/useVtkView';
import { ImageMetadata } from '@/src/types/image';
import { LPSAxisDir } from '@/src/types/lps';
import { getLPSAxisFromDir, getLPSDirections } from '@/src/utils/lps';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';

/**
 * Given an eye frame, return the dimension indices corresponding to the horizontal and vertical dimensions.
 * @param lookAxis
 * @param eyeUpAxis
 * @returns
 */
function eyeFrameDimIndices(lookAxis: 0 | 1 | 2, eyeUpAxis: 0 | 1 | 2) {
  if (lookAxis === 0 && eyeUpAxis === 1) return [2, 1] as Vector2;
  if (lookAxis === 0 && eyeUpAxis === 2) return [1, 2] as Vector2;
  if (lookAxis === 1 && eyeUpAxis === 0) return [2, 0] as Vector2;
  if (lookAxis === 1 && eyeUpAxis === 2) return [0, 2] as Vector2;
  if (lookAxis === 2 && eyeUpAxis === 0) return [1, 0] as Vector2;
  if (lookAxis === 2 && eyeUpAxis === 1) return [0, 1] as Vector2;
  throw new Error(`Invalid lookAxis and eyeUpAxis: ${lookAxis}, ${eyeUpAxis}`);
}

function computeParallelScale(
  lookAxis: 0 | 1 | 2,
  viewUpAxis: 0 | 1 | 2,
  dimensions: Vector3 | vec3,
  viewSize: Vector2
) {
  const [widthIndex, heightIndex] = eyeFrameDimIndices(lookAxis, viewUpAxis);
  const width = dimensions[widthIndex];
  const height = dimensions[heightIndex];
  const dimAspect = width / height;

  const [viewWidth, viewHeight] = viewSize;
  const viewAspect = viewWidth / viewHeight;

  let scale = height / 2;
  if (viewAspect < dimAspect) {
    scale = width / 2 / viewAspect;
  }

  return scale;
}

export function resizeToFit(
  view: View,
  lookAxis: 0 | 1 | 2,
  upAxis: 0 | 1 | 2,
  dimensions: Vector3 | vec3
) {
  const camera = view.renderer.getActiveCamera();
  camera.setParallelScale(
    computeParallelScale(
      lookAxis,
      upAxis,
      dimensions,
      view.renderWindowView.getSize()
    )
  );
}

export function positionCamera(
  camera: vtkCamera,
  directionOfProjection: Vector3,
  viewUp: Vector3,
  focalPoint: Vector3
) {
  const position = vec3.clone(focalPoint) as Vector3;
  vec3.sub(position, position, directionOfProjection);
  camera.setFocalPoint(...focalPoint);
  camera.setPosition(...position);
  camera.setDirectionOfProjection(...directionOfProjection);
  camera.setViewUp(...viewUp);
}

export function resetCameraToImage(
  view: View,
  metadata: ImageMetadata,
  viewDirection: LPSAxisDir,
  viewUp: LPSAxisDir
) {
  const { worldBounds, orientation } = metadata;
  const lpsDirections = getLPSDirections(orientation);

  const center = vtkBoundingBox.getCenter(worldBounds);
  const camera = view.renderer.getActiveCamera();

  const directionOfProjection = lpsDirections[viewDirection] as Vector3;
  const camerViewUp = lpsDirections[viewUp] as Vector3;
  positionCamera(camera, directionOfProjection, camerViewUp, center);

  view.renderer.resetCamera(worldBounds);
  view.requestRender();
}
export function resizeToFitImage(
  view: View,
  metadata: ImageMetadata,
  viewDirection: LPSAxisDir,
  viewUp: LPSAxisDir
) {
  const { lpsOrientation, dimensions } = metadata;
  const viewDirAxis = getLPSAxisFromDir(viewDirection);
  const viewUpAxis = getLPSAxisFromDir(viewUp);
  const lookAxis = lpsOrientation[viewDirAxis];
  const upAxis = lpsOrientation[viewUpAxis];

  resizeToFit(view, lookAxis, upAxis, dimensions);
  view.requestRender();
}
