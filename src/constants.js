export const NO_PROXY = -1;
export const NO_SELECTION = -1;
export const NO_WIDGET = -1;

// instances
export const FileIOInst = Symbol('FileIO');
export const DicomIOInst = Symbol('DicomIO');
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
