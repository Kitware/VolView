import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Extent3D } from '@/src/segmentation/geometry';

/**
 * SegmentMask voxel storage. Its own class so a mask stays distinguishable from
 * the image it sits on, in the type system and in serialized state alike.
 */
export type vtkLabelMap = vtkImageData & {
  getClassName(): 'vtkLabelMap';
  /** Publishes voxel edits bounded in the parent image's index coordinates. */
  modifiedWithin(extent: Extent3D): void;
  /** Bounds of this modification, or null when the whole image changed. */
  getModifiedExtent(): Extent3D | null;
};

export function newInstance(initialValues?: any): vtkLabelMap;

export declare const vtkLabelMap: {
  newInstance: typeof newInstance;
};
export default vtkLabelMap;
