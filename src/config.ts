import HeadMRAThumbnail from '@/src/assets/samples/head-mra.jpg';
import LiverCTThumbnail from '@/src/assets/samples/liver-ct.jpg';
import AbdomenMRIThumbnail from '@/src/assets/samples/abdomen-mri.jpg';
import { Layout, LayoutDirection, ViewConfig, ViewKey } from './store/views';

export const Views: Record<string, ViewConfig> = {
  Coronal: {
    objType: 'View2D',
    key: ViewKey.CoronalView,
    viewDirection: 'Right',
    viewUp: 'Superior',
  },
  Sagittal: {
    objType: 'View2D',
    key: ViewKey.SagittalView,
    viewDirection: 'Posterior',
    viewUp: 'Superior',
  },
  Axial: {
    objType: 'View2D',
    key: ViewKey.AxialView,
    viewDirection: 'Superior',
    viewUp: 'Anterior',
  },
  Three: {
    objType: 'View3D',
    key: ViewKey.ThreeDView,
    viewDirection: 'Posterior',
    viewUp: 'Superior',
  },
};

export const Layouts: Record<string, Layout> = {
  AxialPrimary: {
    objType: 'Layout',
    direction: LayoutDirection.V,
    items: [
      Views.Axial,
      {
        objType: 'Layout',
        direction: LayoutDirection.H,
        items: [Views.Coronal, Views.Sagittal, Views.Three],
      },
    ],
    name: 'Axial Primary',
  },
  QuadView: {
    objType: 'Layout',
    direction: LayoutDirection.H,
    items: [
      {
        objType: 'Layout',
        direction: LayoutDirection.V,
        items: [Views.Coronal, Views.Three],
      },
      {
        objType: 'Layout',
        direction: LayoutDirection.V,
        items: [Views.Sagittal, Views.Axial],
      },
    ],
    name: 'Quad View',
  },
  ThreeOnly: {
    objType: 'Layout',
    direction: LayoutDirection.H,
    items: [Views.Three],
    name: '3D Only',
  },
};

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
