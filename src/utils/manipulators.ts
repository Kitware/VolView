import { Vector3 } from '@kitware/vtk.js/types';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { ImageMetadata } from '../storex/datasets-images';
import { getLPSAxisFromDir, LPSAxisDir } from './lps';

export function createPlaneManipulatorFor2DView(
  viewDir: LPSAxisDir,
  slice: number,
  imageMetadata: ImageMetadata
) {
  const manipulator = vtkPlaneManipulator.newInstance();
  const { lpsOrientation } = imageMetadata;
  const axis = lpsOrientation[getLPSAxisFromDir(viewDir)];

  const normal = lpsOrientation[viewDir];
  const origin = [0, 0, 0];
  origin[axis] = slice;

  manipulator.setNormal(normal as Vector3);
  manipulator.setOrigin(origin as Vector3);
  return manipulator;
}
