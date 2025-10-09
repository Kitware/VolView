import type { RGBColor } from '@kitware/vtk.js/types';

export const EPSILON = 10e-6;
export const NOOP = () => {};
export const NO_NAME = '(no name)';

// themes
export const ThemeStorageKey = 'app-theme';
export const DarkTheme = 'kw-dark';
export const LightTheme = 'kw-light';
export const DefaultTheme = DarkTheme;

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

export const IMAGE_DRAG_MEDIA_TYPE = 'application/x-volview-image-id';

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
  paintEraser: {
    readable: 'Activate Paint tool with eraser',
  },
  brushSize: {
    readable: 'Change brush size by holding key and scrolling',
  },
  rectangle: {
    readable: 'Activate Rectangle tool',
  },
  crosshairs: {
    readable: 'Activate Crosshairs tool',
  },
  temporaryCrosshairs: {
    readable: 'Temporarily activate crosshairs tool',
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

  nextSlice: {
    readable: 'Next slice',
  },
  previousSlice: {
    readable: 'Previous slice',
  },
  grabSlice: {
    readable: 'Change slice by holding key and moving mouse up or down',
  },

  decrementLabel: {
    readable: 'Activate previous label',
  },
  incrementLabel: {
    readable: 'Activate next label',
  },

  deleteCurrentImage: {
    readable: 'Remove current active image',
  },

  clearScene: {
    readable: 'Clear scene',
  },

  mergeNewPolygon: {
    readable:
      'Merge new polygons by holding key and finishing an overlapping polygon',
  },

  showKeyboardShortcuts: {
    readable: 'Show keyboard shortcuts dialog',
  },
} as const;

export type Action = keyof typeof ACTIONS;

export const WLAutoRanges = {
  FullRange: 0,
  LowContrast: 1.0,
  MediumContrast: 2.0,
  HighContrast: 5.0,
};

export const WL_AUTO_DEFAULT = 'FullRange';
export const WL_HIST_BINS = 512;

export const WLPresetsCT = {
  Bones: {
    width: 1000,
    level: 400,
  },
  Air: {
    width: 1000,
    level: -426,
  },
  SoftTissue: {
    width: 350,
    level: 50,
  },
  Lungs: {
    width: 1500,
    level: -600,
  },
  Brain: {
    width: 80,
    level: 40,
  },
};

export const OBLIQUE_OUTLINE_COLORS: Record<string, RGBColor> = {
  ObliqueAxial: [0, 128, 255], // Blue
  ObliqueSagittal: [255, 255, 0], // Yellow
  ObliqueCoronal: [255, 51, 51], // Red
};
