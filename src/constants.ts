import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { ComputedRef, InjectionKey } from '@vue/composition-api';

export const NO_PROXY = -1;
export const NO_SELECTION = -1;
export const NO_WIDGET = -1;

export const EPSILON = 10e-6;
export const NOOP = () => {};

/**
 * Retrieves the parent VtkTwoView's widget manager.
 */
export const VTKTwoViewWidgetManager: InjectionKey<
  ComputedRef<vtkWidgetManager>
> = Symbol('VTKTwoViewWidgetManager');

/**
 * Retrieves the parent VtkThreeView's widget manager.
 */
export const VTKThreeViewWidgetManager: InjectionKey<
  ComputedRef<vtkWidgetManager>
> = Symbol('VTKThreeViewWidgetManager');

// instances
export const FileIOInst = Symbol('FileIO');
export const DICOMIOInst = Symbol('DICOMIO');
export const ProxyManagerInst = Symbol('ProxyManager');

export const DataTypes = {
  Image: 'Image',
  Labelmap: 'Labelmap',
  Dicom: 'DICOM',
  Model: 'Model',
};
