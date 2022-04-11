export const NO_PROXY = -1;
export const NO_SELECTION = -1;
export const NO_WIDGET = -1;

export const EPSILON = 10e-6;

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

export const DEFAULT_LABELMAP_COLORS = {
  0: [0, 0, 0, 0], // eraser
  1: [255, 0, 0, 255],
};

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
