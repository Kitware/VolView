import { Vector3 } from '@kitware/vtk.js/types';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vec3 } from 'gl-matrix';
import { ImageMetadata } from '../store/datasets-images';
import { LPSAxisDir } from '../types/lps';
import { getLPSAxisFromDir } from './lps';

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

  vec3.transformMat4(origin, origin, imageMetadata.indexToWorld);

  manipulator.setUserNormal(normal as Vector3);
  manipulator.setUserOrigin(origin as Vector3);
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
