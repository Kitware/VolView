import { Maybe } from '@/src/types';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { ComputedRef, InjectionKey, Ref } from 'vue';

export const EPSILON = 10e-6;
export const NOOP = () => {};

// themes
export const ThemeStorageKey = 'app-theme';
export const DarkTheme = 'kw-dark';
export const LightTheme = 'kw-light';
export const DefaultTheme = DarkTheme;

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

/**
 * Retrieves the parent tool HTML element.
 */
export const ToolContainer: InjectionKey<Ref<Maybe<HTMLElement>>> =
  Symbol('ToolContainer');

export const DataTypes = {
  Image: 'Image',
  Labelmap: 'Labelmap',
  Dicom: 'DICOM',
  Model: 'Model',
};

export const Messages = {
  WebGLLost: {
    title: 'Viewer Error',
    details:
      'Lost the WebGL context! Please reload the webpage. If the problem persists, you may need to restart your web browser.',
  },
} as const;
