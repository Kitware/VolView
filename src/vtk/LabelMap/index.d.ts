import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

/**
 * Segment voxel storage. Its own class so a mask stays distinguishable from
 * the image it sits on, in the type system and in serialized state alike.
 */
export interface vtkLabelMap extends vtkImageData {
  getClassName(): 'vtkLabelMap';
}

export function newInstance(initialValues?: any): vtkLabelMap;

export declare const vtkLabelMap: {
  newInstance: typeof newInstance;
};
export default vtkLabelMap;
