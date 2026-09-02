import { LabelmapSegment } from '@/src/types/segmentation';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector4 } from '@kitware/vtk.js/types';

export interface vtkLabelMap extends vtkImageData {
  /**
   * Sets the segments of the labelmap.
   * @param segments
   */
  setSegments(segments: LabelmapSegment[]): boolean;

  /**
   * Gets the segments of the labelmap.
   */
  getSegments(): LabelmapSegment[];
}

export function newInstance(initialValues?: any): vtkLabelMap;

export declare const vtkLabelMap: {
  newInstance: typeof newInstance;
};
export default vtkLabelMap;
