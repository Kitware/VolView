import { Vector3 } from '@kitware/vtk.js/types';
import { LPSAxis } from '@/src/types/lps';
import { InteractionState } from '@/src/vtk/RulerWidget/state';

export interface Ruler {
  name: string;
  /**
   * Point is in image index space.
   */
  firstPoint: Vector3 | null;
  /**
   * Point is in image index space.
   */
  secondPoint: Vector3 | null;
  /**
   * The associated view slicing axis.
   */
  viewAxis: LPSAxis | null;
  /**
   * The associated slice along the axis.
   */
  slice: number | null;
  /**
   * The associated image dataset.
   *
   * The ruler currently does not store orientation info,
   * and so depends on the associated image space.
   */
  imageID: string;
  /**
   * The current interaction state.
   */
  interactionState: InteractionState;
  /**
   * Ruler metadata
   */
  color: string;
}

export enum Tools {
  WindowLevel = 'WindowLevel',
  Pan = 'Pan',
  Zoom = 'Zoom',
  Ruler = 'Ruler',
  Paint = 'Paint',
  Crosshairs = 'Crosshairs',
  Crop = 'Crop',
}

export type LPSCroppingPlanes = {
  Sagittal: [number, number];
  Coronal: [number, number];
  Axial: [number, number];
};
