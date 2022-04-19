import { Vector3 } from '@kitware/vtk.js/types';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vec3 } from 'gl-matrix';
import { ImageMetadata } from '../store/datasets-images';
import { getLPSAxisFromDir, LPSAxisDir } from './lps';

export function updatePlaneManipulatorFor2DView(
  manipulator: vtkPlaneManipulator,
  viewDir: LPSAxisDir,
  slice: number,
  imageMetadata: ImageMetadata
) {
  const { lpsOrientation } = imageMetadata;
  const axis = lpsOrientation[getLPSAxisFromDir(viewDir)];

  const normal: vec3 = lpsOrientation[viewDir];
  const origin: vec3 = [0, 0, 0];
  origin[axis] = slice;

  vec3.transformMat3(normal, normal, imageMetadata.orientation);
  vec3.transformMat4(origin, origin, imageMetadata.indexToWorld);

  manipulator.setNormal(normal as Vector3);
  manipulator.setOrigin(origin as Vector3);
}

export function createPlaneManipulatorFor2DView(
  viewDir: LPSAxisDir,
  slice: number,
  imageMetadata: ImageMetadata
) {
  const manipulator = vtkPlaneManipulator.newInstance();
  updatePlaneManipulatorFor2DView(manipulator, viewDir, slice, imageMetadata);
  return manipulator;
}
