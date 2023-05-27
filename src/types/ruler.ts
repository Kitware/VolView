import { FrameOfReference } from '@/src/utils/frameOfReference';
import { Vector3 } from '@kitware/vtk.js/types';

export interface Ruler {
  /**
   * Point is in image index space.
   */
  firstPoint: Vector3;
  /**
   * Point is in image index space.
   */
  secondPoint: Vector3;
  /**
   * The associated frame of reference
   */
  frameOfReference: FrameOfReference;
  /**
   * The associated slice number
   */
  slice: number;
  /**
   * The associated image dataset.
   *
   * The ruler currently does not store orientation info,
   * and so depends on the associated image space.
   */
  imageID: string;
  /**
   * Ruler metadata
   */
  id: string;
  name: string;
  label?: string; // label name
  labelProps: ['color'];
  color: string;
  /**
   * Is this ruler in placing mode
   */
  placing?: boolean;
}
