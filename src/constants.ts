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
