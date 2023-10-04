import vtkIJKSliceRepresentationProxy from '../IJKSliceRepresentationProxy';

export interface vtkLabelMapSliceRepProxy
  extends vtkIJKSliceRepresentationProxy {}

export function extend(publicAPI: object, model: object): void;

export declare const vtkLabelMapSliceRepProxy: {
  extend: typeof extend;
};

export default vtkLabelMapSliceRepProxy;
