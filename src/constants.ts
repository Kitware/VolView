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

export const ANNOTATION_TOOL_HANDLE_RADIUS = 6; // CSS pixels
export const PICKABLE_ANNOTATION_TOOL_HANDLE_RADIUS =
  ANNOTATION_TOOL_HANDLE_RADIUS * 2;

export const ACTIONS = {
  windowLevel: {
    readable: 'Activate Window/Level tool',
  },
  pan: {
    readable: 'Activate Pan tool',
  },
  zoom: {
    readable: 'Activate Zoom tool',
  },
  ruler: {
    readable: 'Activate Ruler tool',
  },
  paint: {
    readable: 'Activate Paint tool',
  },
  rectangle: {
    readable: 'Activate Rectangle tool',
  },
  crosshairs: {
    readable: 'Activate Crosshairs tool',
  },
  crop: {
    readable: 'Activate Crop tool',
  },
  polygon: {
    readable: 'Activate Polygon tool',
  },
  select: {
    readable: 'Activate Select tool',
  },

  decrementLabel: {
    readable: 'Activate previous Label',
  },
  incrementLabel: {
    readable: 'Activate next Label',
  },

  showKeyboardShortcuts: {
    readable: 'Show keyboard shortcuts dialog',
  },
} as const;

export type Action = keyof typeof ACTIONS;

export const WLAutoRanges = {
  Default: 0.1,
  OnePercent: 1.0,
  TwoPercent: 2.0,
  FivePercent: 5.0,
};
