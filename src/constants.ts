import HeadMRAThumbnail from '@/src/assets/samples/head-mra.jpg';
import LiverCTThumbnail from '@/src/assets/samples/liver-ct.jpg';
import AbdomenMRIThumbnail from '@/src/assets/samples/abdomen-mri.jpg';

export const NO_PROXY = -1;
export const NO_SELECTION = -1;
export const NO_WIDGET = -1;

export const EPSILON = 10e-6;
export const NOOP = () => {};

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
