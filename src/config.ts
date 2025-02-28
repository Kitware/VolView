import MRICardiacThumbnail from '@/src/assets/samples/MRI-Cardiac.jpg';
import MRIPROSTATExThumbnail from '@/src/assets/samples/MRI-PROSTATEx.jpg';
import MRAHeadThumbnail from '@/src/assets/samples/MRA-Head_and_Neck.jpg';
import CTAHeadThumbnail from '@/src/assets/samples/CTA-Head_and_Neck.jpg';
import USFetusThumbnail from '@/src/assets/samples/3DUS-Fetus.jpg';
import { SegmentMask } from '@/src/types/segment';
import { Layout, LayoutDirection } from './types/layout';
import { ViewSpec } from './types/views';
import { SampleDataset } from './types';
import { Action } from './constants';

/**
 * These are the initial view IDs.
 *
 * These view IDs get mapped to components in core/viewTypes.ts.
 */
export const InitViewIDs: Record<string, string> = {
  Coronal: 'Coronal',
  Sagittal: 'Sagittal',
  Axial: 'Axial',
  Three: '3D',
  ObliqueCoronal: 'ObliqueCoronal',
  ObliqueSagittal: 'ObliqueSagittal',
  ObliqueAxial: 'ObliqueAxial',
  ObliqueThree: 'Oblique3D',
};

/**
 * View spec for the initial view IDs.
 */
export const InitViewSpecs: Record<string, ViewSpec> = {
  [InitViewIDs.Coronal]: {
    viewType: '2D',
    props: {
      viewDirection: 'Posterior',
      viewUp: 'Superior',
    },
  },
  [InitViewIDs.Sagittal]: {
    viewType: '2D',
    props: {
      viewDirection: 'Right',
      viewUp: 'Superior',
    },
  },
  [InitViewIDs.Axial]: {
    viewType: '2D',
    props: {
      viewDirection: 'Superior',
      viewUp: 'Anterior',
    },
  },
  [InitViewIDs.ObliqueCoronal]: {
    viewType: 'Oblique',
    props: {
      viewDirection: 'Posterior',
      viewUp: 'Superior',
    },
  },
  [InitViewIDs.ObliqueSagittal]: {
    viewType: 'Oblique',
    props: {
      viewDirection: 'Right',
      viewUp: 'Superior',
    },
  },
  [InitViewIDs.ObliqueAxial]: {
    viewType: 'Oblique',
    props: {
      viewDirection: 'Superior',
      viewUp: 'Anterior',
    },
  },
  [InitViewIDs.Three]: {
    viewType: '3D',
    props: {
      viewDirection: 'Posterior',
      viewUp: 'Superior',
    },
  },
  [InitViewIDs.ObliqueThree]: {
    viewType: 'Oblique3D',
    props: {
      viewDirection: 'Posterior',
      viewUp: 'Superior',
      slices: [
        {
          viewID: InitViewIDs.ObliqueSagittal,
          axis: 'Sagittal',
        },
        {
          viewID: InitViewIDs.ObliqueCoronal,
          axis: 'Coronal',
        },
        {
          viewID: InitViewIDs.ObliqueAxial,
          axis: 'Axial',
        },
      ],
    },
  },
};

/**
 * The default view spec.
 */
export const DefaultViewSpec = InitViewSpecs[InitViewIDs.Axial];

/**
 * The default layout.
 */
export const DefaultLayoutName = 'Quad View';

/**
 * Defines the default layouts.
 */
export const Layouts: Record<string, Layout> = [
  {
    name: 'Axial Only',
    direction: LayoutDirection.H,
    items: [InitViewIDs.Axial],
  },
  {
    name: 'Axial Primary',
    direction: LayoutDirection.V,
    items: [
      InitViewIDs.Axial,
      {
        direction: LayoutDirection.H,
        items: [InitViewIDs.Three, InitViewIDs.Coronal, InitViewIDs.Sagittal],
      },
    ],
  },
  {
    name: '3D Primary',
    direction: LayoutDirection.V,
    items: [
      InitViewIDs.Three,
      {
        direction: LayoutDirection.H,
        items: [InitViewIDs.Coronal, InitViewIDs.Sagittal, InitViewIDs.Axial],
      },
    ],
  },
  {
    name: 'Quad View',
    direction: LayoutDirection.H,
    items: [
      {
        direction: LayoutDirection.V,
        items: [InitViewIDs.Coronal, InitViewIDs.Three],
      },
      {
        direction: LayoutDirection.V,
        items: [InitViewIDs.Sagittal, InitViewIDs.Axial],
      },
    ],
  },
  {
    name: 'Oblique View',
    direction: LayoutDirection.H,
    items: [
      {
        direction: LayoutDirection.V,
        items: [InitViewIDs.ObliqueCoronal, InitViewIDs.ObliqueThree],
      },
      {
        direction: LayoutDirection.V,
        items: [InitViewIDs.ObliqueSagittal, InitViewIDs.ObliqueAxial],
      },
    ],
  },
  {
    name: '3D Only',
    direction: LayoutDirection.H,
    items: [InitViewIDs.Three],
  },
].reduce((layouts, layout) => {
  return { ...layouts, [layout.name]: layout };
}, {});

export const SAMPLE_DATA: SampleDataset[] = [
  {
    name: 'CTA Head and Neck',
    filename: 'CTA-Head_and_Neck.zip',
    description:
      'CTA head and neck scan of elderly patient with tumor. (80 MB)',
    url: 'https://data.kitware.com/api/v1/item/6347159711dab81428208e24/download',
    image: CTAHeadThumbnail,
  },
  {
    name: 'MRA Head and Neck',
    filename: 'MRA-Head_and_Neck.zip',
    description:
      'MRA from Patient Contributed Image Repository. Click application help icon "(?)" for more info. (15 MB)',
    url: 'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
    image: MRAHeadThumbnail,
  },
  {
    name: 'MRI Cardiac 3D and Cine',
    filename: 'MRI-Cardiac-3D_and_Cine.zip',
    description:
      'MRI scan with two series: 3D axial non-gated and 2 chamber cine. (4 MB)',
    url: 'https://data.kitware.com/api/v1/item/6350b28f11dab8142820949d/download',
    image: MRICardiacThumbnail,
  },
  {
    name: 'MRI PROSTATEx',
    filename: 'MRI-PROSTATEx-0004.zip',
    description:
      'MRI from the SPIE-AAPM-NCI PROSTATEx challenge. Click application help "(?)" icon for more info. (3 MB)',
    url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
    image: MRIPROSTATExThumbnail,
  },
  {
    name: '3D US Fetus',
    filename: '3DUS-Fetus.mha',
    description:
      '3D ultrasound of a baby. Downloaded from tomovision.com.(8 MB)',
    url: 'https://data.kitware.com/api/v1/item/635679c311dab8142820a4f4/download',
    image: USFetusThumbnail,
    defaults: {
      colorPreset: 'US-Fetal',
    },
  },
];

export const TOOL_COLORS = [
  '#58f24c',
  '#8de4d3',
  '#f0a4b1',
  '#a3c9fe',
  '#c8f251',
  '#fea53b',
];

export const STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT = 1;

export const RULER_LABEL_DEFAULTS = {
  red: { color: 'red' },
  green: { color: '#00ff00' },
  white: { color: '#ffffff' },
};

export const RECTANGLE_LABEL_DEFAULTS = {
  artifact: { color: '#888888' },
  innocuous: { color: '#00ff00' },
  lesion: { color: 'red' },
};

export const POLYGON_LABEL_DEFAULTS = {
  red: { color: 'red' },
  green: { color: '#00ff00' },
  white: { color: '#ffffff' },
};

export const DEFAULT_PRESET_BY_MODALITY: Record<string, string> = {
  CT: 'CT-AAA',
  MR: 'CT-Coronary-Arteries-2',
  US: 'US-Fetal',
};
export const DEFAULT_PRESET = 'CT-AAA';

export const LAYER_PRESET_BY_MODALITY: Record<string, string> = {
  ...DEFAULT_PRESET_BY_MODALITY,
  PT: '2hot-opaque',
};
export const LAYER_PRESET_DEFAULT = 'Blue to Red Rainbow';

// Keyboard shortcuts/hotkeys. Can add modifiers: 'Shift+Ctrl+a'
export const ACTION_TO_KEY = {
  windowLevel: 'l',
  pan: 'n',
  zoom: 'z',
  ruler: 'm',
  paint: 'p',
  rectangle: 'r',
  crosshairs: 'c',
  crop: 'b',
  polygon: 'g',
  mergeNewPolygon: 'Shift',
  select: 's',

  nextSlice: 'arrowdown',
  previousSlice: 'arrowup',

  decrementLabel: 'q',
  incrementLabel: 'w',

  deleteCurrentImage: 'ctrl+.',
  clearScene: 'ctrl+/',

  showKeyboardShortcuts: '?',
} satisfies Record<Action, string>;

export const DEFAULT_SEGMENT_MASKS: SegmentMask[] = [
  {
    value: 1,
    name: 'Tissue',
    color: [255, 0, 0, 255],
    visible: true,
  },
  {
    value: 2,
    name: 'Liver',
    color: [0, 255, 0, 255],
    visible: true,
  },
  {
    value: 3,
    name: 'Heart',
    color: [0, 0, 255, 255],
    visible: true,
  },
];

// from https://github.com/InsightSoftwareConsortium/itk-viewer-color-maps/blob/main/src/CategoricalColors.json
export const CATEGORICAL_COLORS = [
  [214, 0, 0],
  [59, 255, 1],
  [0, 0, 172],
  [151, 255, 0],
  [126, 209, 107],
  [79, 255, 165],
  [87, 59, 0],
  [86, 89, 0],
  [221, 0, 253],
  [161, 117, 105],
  [182, 255, 149],
  [119, 191, 3],
  [100, 84, 116],
  [0, 0, 7],
  [216, 253, 244],
  [0, 75, 0],
  [121, 0, 255],
  [102, 237, 184],
  [93, 126, 102],
  [228, 255, 235],
  [119, 165, 123],
  [89, 0, 163],
  [198, 0, 158],
  [0, 156, 59],
  [202, 195, 0],
  [130, 151, 0],
  [137, 130, 135],
  [93, 54, 59],
  [0, 0, 253],
  [255, 189, 230],
  [219, 109, 1],
  [184, 181, 228],
  [255, 47, 82],
  [195, 102, 144],
  [98, 31, 196],
  [114, 3, 130],
  [105, 230, 128],
  [38, 144, 109],
  [255, 77, 51],
  [133, 163, 1],
  [3, 202, 193],
  [196, 196, 86],
  [117, 87, 61],
  [103, 66, 0],
  [212, 218, 223],
  [249, 255, 0],
  [103, 175, 195],
  [0, 225, 205],
  [218, 149, 255],
  [3, 253, 145],
  [130, 160, 0],
  [86, 154, 84],
  [140, 142, 54],
  [38, 151, 165],
  [142, 140, 94],
  [70, 0, 200],
  [249, 174, 109],
  [110, 207, 167],
  [255, 140, 140],
  [177, 119, 54],
  [255, 160, 121],
  [0, 31, 255],
  [68, 94, 17],
  [103, 151, 147],
  [94, 147, 75],
  [116, 82, 145],
  [170, 112, 49],
  [207, 253, 0],
  [107, 96, 52],
  [144, 212, 47],
  [212, 124, 80],
  [161, 77, 35],
  [124, 89, 0],
  [205, 68, 130],
  [207, 77, 253],
  [137, 0, 61],
  [82, 91, 0],
  [156, 170, 130],
  [128, 112, 142],
  [100, 253, 195],
  [137, 205, 40],
  [255, 154, 181],
  [93, 186, 33],
  [1, 0, 142],
  [98, 128, 35],
  [135, 191, 151],
  [212, 205, 126],
  [209, 182, 91],
  [0, 110, 153],
  [68, 175, 198],
  [242, 255, 209],
  [235, 1, 205],
  [188, 68, 0],
  [121, 156, 126],
  [112, 70, 147],
  [186, 0, 84],
  [172, 147, 235],
  [163, 22, 94],
  [128, 0, 75],
  [124, 184, 211],
  [42, 0, 56],
  [100, 184, 0],
  [255, 128, 61],
  [209, 232, 128],
  [89, 33, 52],
  [161, 93, 110],
  [181, 175, 158],
  [70, 51, 124],
  [193, 65, 0],
  [232, 61, 107],
  [232, 117, 188],
  [165, 196, 168],
  [84, 110, 216],
  [56, 251, 124],
  [75, 100, 73],
  [195, 235, 121],
  [54, 75, 142],
  [70, 135, 255],
  [0, 195, 233],
  [212, 255, 188],
  [70, 72, 0],
  [198, 255, 144],
  [233, 79, 105],
  [230, 93, 177],
  [144, 175, 87],
  [42, 175, 93],
  [133, 109, 225],
  [110, 114, 228],
  [226, 184, 182],
  [56, 45, 0],
  [126, 163, 172],
  [47, 168, 186],
  [105, 181, 130],
  [209, 144, 175],
  [70, 7, 94],
  [0, 151, 137],
  [15, 1, 91],
  [128, 47, 87],
  [228, 100, 59],
  [63, 40, 114],
  [188, 75, 82],
  [200, 121, 221],
  [49, 144, 200],
  [242, 5, 170],
  [167, 107, 154],
  [175, 0, 96],
  [98, 242, 221],
  [119, 68, 1],
  [36, 65, 103],
  [202, 121, 158],
  [12, 232, 161],
  [247, 219, 131],
  [117, 142, 109],
  [226, 65, 47],
  [73, 107, 121],
  [133, 255, 207],
  [75, 93, 198],
  [179, 145, 255],
  [237, 214, 239],
  [191, 96, 38],
  [163, 181, 188],
  [0, 135, 110],
  [255, 47, 161],
  [232, 175, 51],
  [75, 184, 140],
  [107, 135, 82],
  [147, 209, 26],
  [253, 161, 59],
  [163, 80, 168],
  [0, 151, 137],
  [123, 89, 87],
  [249, 142, 138],
  [214, 124, 112],
  [1, 24, 89],
  [22, 38, 255],
  [216, 86, 247],
  [253, 121, 149],
  [177, 167, 212],
  [207, 221, 0],
  [175, 121, 70],
  [218, 255, 230],
  [5, 177, 242],
  [255, 163, 228],
  [137, 19, 35],
  [103, 130, 232],
  [112, 216, 170],
  [223, 186, 212],
  [82, 105, 117],
  [154, 151, 51],
  [228, 114, 126],
  [89, 38, 119],
  [105, 47, 61],
] as const;
