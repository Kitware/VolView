// Every file the suite fetches from the internet. The runner downloads them
// into the dataset cache before any spec starts, and specs read them from the
// local server at `/tmp/<name>`. CI keys its dataset cache on this file.

export const ONE_CT_SLICE_DICOM = {
  url: 'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
  name: 'CT000085.dcm',
} as const;

export const MINIMAL_DICOM = {
  url: 'https://data.kitware.com/api/v1/file/68e9807dbf0f869935e36481/download',
  name: 'minimal.dcm',
} as const;

export const MINIMAL_501_SESSION = {
  url: 'https://data.kitware.com/api/v1/file/693077d880eaefe49a4abb88/download',
  name: 'minimal-501-session.volview.zip',
} as const;

export const PROSTATEX_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
  name: 'prostate.zip',
} as const;

export const PROSTATE_SEGMENT_GROUP = {
  url: 'https://data.kitware.com/api/v1/file/692f13ed80eaefe49a4abb72/download',
  name: 'prostate-total.seg.nii.gz',
} as const;

export const MRA_HEAD_NECK_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
  name: 'MRA-Head_and_Neck.zip',
} as const;

export const FETUS_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/635679c311dab8142820a4f4/download',
  name: 'fetus.zip',
} as const;

// Multiframe ultrasound DICOM from pydicom public test data.
// SequenceOfUltrasoundRegions: PhysicalDeltaX/Y = 0.05104970559 cm/pixel
// (unit code 3 = cm), so with US spacing fix the VTK spacing is ~0.5105 mm.
export const US_MULTIFRAME_DICOM = {
  url: 'https://data.kitware.com/api/v1/file/69e1630646ef98a20f563020/download',
  name: 'US_multiframe_30frames.dcm',
} as const;

// 8-frame echocardiogram from the BSD-licensed GDCM test corpus. Native
// Explicit VR LE, MONOCHROME2, retired Ultrasound Multi-frame SOP UID.
export const CINE_US_DATASET = {
  url: 'https://sourceforge.net/p/gdcm/gdcmdata/ci/master/tree/US-MONO2-8-8x-execho.dcm?format=raw',
  name: 'US-MONO2-8-8x-echo.dcm',
} as const;

// 120-frame RGB ultrasound cine encoded as JPEG Baseline. Exercises the async
// browser JPEG decode path used by common compressed ultrasound clips.
export const COLOR3D_JPEG_BASELINE_DICOM = {
  url: 'https://raw.githubusercontent.com/pydicom/pydicom-data/master/data_store/data/color3d_jpeg_baseline.dcm',
  name: 'color3d_jpeg_baseline.dcm',
} as const;

export const CT_ELECTRODES = {
  url: 'https://raw.githubusercontent.com/neurolabusc/niivue-images/main/CT_Electrodes.nii.gz',
  name: 'CT_Electrodes.nii.gz',
} as const;

export const TEST_DATASETS = [
  ONE_CT_SLICE_DICOM,
  MINIMAL_DICOM,
  MINIMAL_501_SESSION,
  PROSTATEX_DATASET,
  PROSTATE_SEGMENT_GROUP,
  MRA_HEAD_NECK_DATASET,
  FETUS_DATASET,
  US_MULTIFRAME_DICOM,
  CINE_US_DATASET,
  COLOR3D_JPEG_BASELINE_DICOM,
  CT_ELECTRODES,
] as const;

export type TestDataset = (typeof TEST_DATASETS)[number];
