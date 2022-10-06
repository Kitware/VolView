import HeadMRAThumbnail from '@/src/assets/samples/head-mra.jpg';
import LiverCTThumbnail from '@/src/assets/samples/liver-ct.jpg';
import AbdomenMRIThumbnail from '@/src/assets/samples/abdomen-mri.jpg';
import { Layout, LayoutDirection } from './types/layout';
import { ViewSpec } from './types/views';

/**
 * These are the initial view IDs.
 */
export const InitViewIDs: Record<string, string> = {
  Coronal: 'Coronal',
  Sagittal: 'Sagittal',
  Axial: 'Axial',
  Three: '3D',
};

/**
 * View spec for the initial view IDs.
 */
export const InitViewSpecs: Record<string, ViewSpec> = {
  [InitViewIDs.Coronal]: {
    viewType: '2D',
    props: {
      viewDirection: 'Right',
      viewUp: 'Superior',
    },
  },
  [InitViewIDs.Sagittal]: {
    viewType: '2D',
    props: {
      viewDirection: 'Posterior',
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
  [InitViewIDs.Three]: {
    viewType: '3D',
    props: {
      viewDirection: 'Posterior',
      viewUp: 'Superior',
    },
  },
};

/**
 * The default view spec.
 */
export const DefaultViewSpec = InitViewSpecs[InitViewIDs.Axial];

/**
 * Defines the default layouts.
 */
export const Layouts: Record<string, Layout> = [
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
    name: '3D Only',
    direction: LayoutDirection.H,
    items: [InitViewIDs.Three],
  },
].reduce((layouts, layout) => {
  return { ...layouts, [layout.name]: layout };
}, {});

export const LABELMAP_PALETTE = {
  0: [0, 0, 0, 0], // eraser
  1: [153, 153, 0, 255],
  2: [76, 76, 0, 255],
  3: [255, 255, 0, 255],
  4: [0, 76, 0, 255],
  5: [0, 153, 0, 255],
  6: [0, 255, 0, 255],
  7: [76, 0, 0, 255],
  8: [153, 0, 0, 255],
  9: [255, 0, 0, 255],
  10: [0, 76, 76, 255],
  11: [0, 153, 153, 255],
  12: [0, 255, 255, 255],
  13: [0, 0, 76, 255],
  14: [0, 0, 153, 255],
} as Record<number, number[]>;

export const SAMPLE_DATA = [
  {
    name: 'HEAD-MRA',
    filename: 'HEAD-MRA.mha',
    description: 'A head scanned using magnetic resonance angiography (MRA).',
    url: 'https://data.kitware.com/api/v1/item/620db46f4acac99f42e753f9/download',
    image: HeadMRAThumbnail,
  },
  {
    name: 'LIVER-CT',
    filename: 'LIVER-CT.mha',
    description: 'A computerized tomography (CT) scan of a liver.',
    url: 'https://data.kitware.com/api/v1/item/620db4b74acac99f42e75418/download',
    image: LiverCTThumbnail,
  },
  {
    name: 'ABDOMEN-MRI',
    filename: 'ABDOMEN-MRI.zip',
    description: 'A DICOM dataset of an abdomen MRI scan.',
    url: 'https://data.kitware.com/api/v1/item/620db9154acac99f42e77867/download',
    image: AbdomenMRIThumbnail,
  },
];

export type Sample = typeof SAMPLE_DATA[0];

export const TOOL_COLORS = [
  '#8de4d3',
  '#f0a4b1',
  '#58f24c',
  '#a3c9fe',
  '#c8f251',
  '#fea53b',
];

export const DEFAULT_PRESET_BY_MODALITY: Record<string, string> = {
  CT: 'CT-AAA',
  MR: 'MR-Default',
};
