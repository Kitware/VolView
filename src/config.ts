import MRICardiacThumbnail from '@/src/assets/samples/MRI-Cardiac.jpg';
import MRIPROSTATExThumbnail from '@/src/assets/samples/MRI-PROSTATEx.jpg';
import MRAHeadThumbnail from '@/src/assets/samples/MRA-Head_and_Neck.jpg';
import CTAHeadThumbnail from '@/src/assets/samples/CTA-Head_and_Neck.jpg';
import CTAChestThumbnail from '@/src/assets/samples/CTA-Chest.jpg';
import { Layout, LayoutDirection } from './types/layout';
import { ViewSpec } from './types/views';
import { SampleDataset } from './types';

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

export const SAMPLE_DATA: SampleDataset[] = [
  {
    name: 'CTA Head and Neck',
    filename: 'CTA-Head_and_Neck.zip',
    description:
      'CTA head and neck scan of elderly patient with tumor. (80 MB)',
    url: 'https://data.kitware.com/api/v1/item/6347159711dab81428208e24/download',
    image: CTAHeadThumbnail,
    volumeKey:
      '2.16.840.1.114362.1.11972228.22789312658.616067305.306.3.6151251220120507.1D000000S0D000000S0D000000S0D000000S1D000000S0D000000',
  },
  {
    name: 'CTA Chest',
    filename: 'CTA-Chest.zip',
    description:
      'High-resolution, large field-of-view chest CTA scan. (147 MB)',
    url: 'https://data.kitware.com/api/v1/item/6347145311dab81428208e20/download',
    image: CTAChestThumbnail,
    volumeKey:
      '2.16.840.1.114362.1.11972228.22789312658.561585527.143.7.60.651251220200409.1D000000S0D000000S0D000000S0D000000S1D000000S0D000000',
  },
  {
    name: 'MRA Head and Neck',
    filename: 'MRA-Head_and_Neck.zip',
    description:
      'MRA from Patient Contributed Image Repository. Click application help icon "(?)" for more info. (15 MB)',
    url: 'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
    image: MRAHeadThumbnail,
    volumeKey:
      '1.2.276.0.50.192168001099.7810872.14547392.458.6012.051251220070511.1D000000S0D000000S0D000000S0D000000S0D711030SN0D703161',
  },
  {
    name: 'MRI Cardiac 3D and Cine',
    filename: 'MRI-Cardiac-3D_and_Cine.zip',
    description:
      'MRI scan with two series: 3D axial non-gated and 2 chamber cine. (4 MB)',
    url: 'https://data.kitware.com/api/v1/item/6350b28f11dab8142820949d/download',
    image: MRICardiacThumbnail,
    volumeKey:
      '1.2.276.0.50.192168001099.7810872.14547392.458.6012.051251220070511.1D000000S0D000000S0D000000S0D000000S0D711030SN0D703161',
  },
  {
    name: 'MRI PROSTATEx',
    filename: 'MRI-PROSTATEx-0004.zip',
    description:
      'MRI from the SPIE-AAPM-NCI PROSTATEx challenge. Click application help "(?)" icon for more info. (3 MB)',
    url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
    image: MRIPROSTATExThumbnail,
    volumeKey:
      '1.2.276.0.50.192168001099.7810872.14547392.458.6012.051251220070511.1D000000S0D000000S0D000000S0D000000S0D711030SN0D703161',
  },
];

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
