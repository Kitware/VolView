import { SegmentMask } from '@/src/types/segment';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector4 } from '@kitware/vtk.js/types';

export interface vtkLabelMap extends vtkImageData {
  /**
   * Sets the segments of the labelmap.
   * @param segments
   */
  setSegments(segments: SegmentMask[]): boolean;

  /**
   * Gets the segments of the labelmap.
   */
  getSegments(): SegmentMask[];

  /**
   * Replaces a labelmap value with another value.
   * @param from
   * @param to
   */
  replaceLabelValue(from: number, to: number): void;
}

export function newInstance(initialValues?: any): vtkLabelMap;

export declare const vtkLabelMap: {
  newInstance: typeof newInstance;
};
export default vtkLabelMap;
