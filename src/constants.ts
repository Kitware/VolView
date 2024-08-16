import type { RGBColor } from '@kitware/vtk.js/types';

export const EPSILON = 10e-6;
export const NOOP = () => {};

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

  mergeNewPolygon: {
    readable: 'Hold down to merge new polygons with overlapping polygons',
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
  Head: {
    Brain: {
      width: 80,
      level: 40,
    },
    Subdural: {
      width: 300,
      level: 100,
    },
    Stroke: {
      width: 40,
      level: 40,
    },
    Bones: {
      width: 2800,
      level: 600,
    },
    SoftTissue: {
      width: 400,
      level: 60,
    },
  },
  Chest: {
    Lungs: {
      width: 1500,
      level: -600,
    },
    Mediastinum: {
      width: 350,
      level: 50,
    },
  },
  Abdomen: {
    SoftTissue: {
      width: 400,
      level: 50,
    },
    Liver: {
      width: 150,
      level: 30,
    },
  },
  Spine: {
    SoftTissue: {
      width: 250,
      level: 50,
    },
    Bones: {
      width: 1800,
      level: 400,
    },
  },
};

export const OBLIQUE_OUTLINE_COLORS: Record<string, RGBColor> = {
  ObliqueAxial: [0, 128, 255], // Blue
  ObliqueSagittal: [255, 255, 0], // Yellow
  ObliqueCoronal: [255, 51, 51], // Red
};
