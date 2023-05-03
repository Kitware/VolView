/**
 * application/vnd.unknown is used as a collective namespace for the purpose
 * of this application only.
 */
export const FILE_EXT_TO_MIME: Record<string, string> = {
  vti: 'application/vnd.unknown.vti',
  vtp: 'application/vnd.unknown.vtp',

  stl: 'model/stl',

  dcm: 'application/dicom',

  zip: 'application/zip',

  json: 'application/json',

  // itk-wasm supported formats (from extensionToImageIO)

  gipl: 'application/vnd.unknown.gipl',
  'gipl.gz': 'application/vnd.unknown.gipl',

  hdf5: 'application/x-hdf5',

  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',

  lsm: 'application/vnd.unknown.lsm',

  mnc: 'application/vnd.unknown.minc',
  'mnc.gz': 'application/vnd.unknown.minc',
  mnc2: 'application/vnd.unknown.minc',

  mgh: 'application/vnd.unknown.mgh',
  mgz: 'application/vnd.unknown.mgh',
  'mgh.gz': 'application/vnd.unknown.mgh',

  mha: 'application/vnd.unknown.metaimage',
  mhd: 'application/vnd.unknown.metaimage',

  mrc: 'application/vnd.unknown.mrc',

  nia: 'application/vnd.unknown.nifti-1',
  nii: 'application/vnd.unknown.nifti-1',
  'nii.gz': 'application/vnd.unknown.nifti-1',
  hdr: 'application/vnd.unknown.nifti-1',

  nrrd: 'application/vnd.unknown.nrrd',
  nhdr: 'application/vnd.unknown.nrrd',

  png: 'image/png',

  pic: 'application/vnd.unknown.biorad',

  tif: 'image/tiff',
  tiff: 'image/tiff',

  vtk: 'application/vnd.unknown.vtk',

  isq: 'application/vnd.unknown.scanco',

  fdf: 'application/vnd.unknown.fdf',
};

export const FILE_EXTENSIONS = new Set(Object.keys(FILE_EXT_TO_MIME));
export const MIME_TYPES = new Set(Object.values(FILE_EXT_TO_MIME));

/**
 * Supported archives
 */
export const ARCHIVE_FILE_TYPES = new Set(['application/zip']);
