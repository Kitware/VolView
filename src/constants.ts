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
  1: [76, 0, 0, 255],
  2: [153, 0, 0, 255],
  3: [255, 0, 0, 255],
  4: [76, 76, 0, 255],
  5: [153, 153, 0, 255],
  6: [255, 255, 0, 255],
  7: [0, 76, 0, 255],
  8: [0, 153, 0, 255],
  9: [0, 255, 0, 255],
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
    description: '',
    url:
      'https://data.kitware.com/api/v1/item/620db46f4acac99f42e753f9/download',
    image: '',
  },
  {
    name: 'LIVER-CT',
    filename: 'LIVER-CT.mha',
    description: '',
    url:
      'https://data.kitware.com/api/v1/item/620db4b74acac99f42e75418/download',
    image: '',
  },
  {
    name: 'ABDOMEN-MRI',
    filename: 'ABDOMEN-MRI.zip',
    description: '',
    url:
      'https://data.kitware.com/api/v1/item/620db9154acac99f42e77867/download',
    image: '',
  },
];

export type Sample = typeof SAMPLE_DATA[0];
