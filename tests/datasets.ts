// Every file the suite fetches from the internet. The runner downloads them
// into the dataset cache before any spec starts, and specs read them from the
// local server at `/tmp/<name>`. CI keys its dataset cache on this file.
//
// The files are assets of one GitHub release. An asset can be replaced after
// it is published, so each download is checked against its hash. To change or
// add a file, publish a new release and point DATASET_RELEASE at it.
export const DATASET_RELEASE =
  'https://github.com/PaulHax/VolView/releases/download/test-data-1';

// `origin` is where the file was first published.
const DATASETS = {
  ONE_CT_SLICE_DICOM: {
    name: 'CT000085.dcm',
    origin:
      'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
    sha256: '8c9c3477a3bcf54477f7705c9f60ec2473699b8ac93a11f00332873c1dde6b9b',
  },
  MINIMAL_DICOM: {
    name: 'minimal.dcm',
    origin:
      'https://data.kitware.com/api/v1/file/68e9807dbf0f869935e36481/download',
    sha256: 'c0d05d47b16cbc2e1a913c5b1dc1b5c982eb8499f7674c2e5933a81d5ab878a1',
  },
  MINIMAL_501_SESSION: {
    name: 'minimal-501-session.volview.zip',
    origin:
      'https://data.kitware.com/api/v1/file/693077d880eaefe49a4abb88/download',
    sha256: 'e2dded0c7bcabae6611e4bcc7e0170e2902640624de60043aa6d363630844d7d',
  },
  PROSTATEX_DATASET: {
    name: 'prostate.zip',
    origin:
      'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
    sha256: '2db4738cc063f80eaaeffd52b83271dca1e3543518a54240c01e5ba2d5629dd1',
  },
  PROSTATE_SEGMENT_GROUP: {
    name: 'prostate-total.seg.nii.gz',
    origin:
      'https://data.kitware.com/api/v1/file/692f13ed80eaefe49a4abb72/download',
    sha256: '30704eab70795d242f529c63c467867f7ac5256a8bf50af28a272bc6c866f394',
  },
  MRA_HEAD_NECK_DATASET: {
    name: 'MRA-Head_and_Neck.zip',
    origin:
      'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
    sha256: 'd1d692f449e94294f1204040c43aa313b84fb4d6be9eb4c8558f78435126f875',
  },
  FETUS_DATASET: {
    name: 'fetus.zip',
    origin:
      'https://data.kitware.com/api/v1/item/635679c311dab8142820a4f4/download',
    sha256: '3cf89e3d24dfaaea61b006e797df6976a8b2e94a63637e34e16c3608d6e19464',
  },
  // Multiframe ultrasound DICOM from pydicom public test data.
  // SequenceOfUltrasoundRegions: PhysicalDeltaX/Y = 0.05104970559 cm/pixel
  // (unit code 3 = cm), so with US spacing fix the VTK spacing is ~0.5105 mm.
  US_MULTIFRAME_DICOM: {
    name: 'US_multiframe_30frames.dcm',
    origin:
      'https://data.kitware.com/api/v1/file/69e1630646ef98a20f563020/download',
    sha256: '6fa3a087d3c631b43216a8abec8aac8d2d73751c5bf5885708d1150b09283f72',
  },
  // 8-frame echocardiogram from the BSD-licensed GDCM test corpus. Native
  // Explicit VR LE, MONOCHROME2, retired Ultrasound Multi-frame SOP UID.
  CINE_US_DATASET: {
    name: 'US-MONO2-8-8x-echo.dcm',
    origin:
      'https://sourceforge.net/p/gdcm/gdcmdata/ci/master/tree/US-MONO2-8-8x-execho.dcm?format=raw',
    sha256: '7d3f54806d0315c6cfc8b7371649a242b5ef8f31e0d20221971dd8087f2ff1ea',
  },
  // 120-frame RGB ultrasound cine encoded as JPEG Baseline. Exercises the async
  // browser JPEG decode path used by common compressed ultrasound clips.
  COLOR3D_JPEG_BASELINE_DICOM: {
    name: 'color3d_jpeg_baseline.dcm',
    origin:
      'https://raw.githubusercontent.com/pydicom/pydicom-data/master/data_store/data/color3d_jpeg_baseline.dcm',
    sha256: 'c8798b8abf8ae0a18e8c9952e7c7f75f3cc8465234b1b63f9e3ba3bebb9d5625',
  },
  CT_ELECTRODES: {
    name: 'CT_Electrodes.nii.gz',
    origin:
      'https://raw.githubusercontent.com/neurolabusc/niivue-images/main/CT_Electrodes.nii.gz',
    sha256: '0566942708ff451458d0fdb1f61c4611187bb5cc0efa516c8500f1ff3c142e57',
  },
} as const;

export const {
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
} = DATASETS;

// Everything declared above is downloaded.
export const TEST_DATASETS = Object.values(DATASETS);

export type TestDataset = (typeof TEST_DATASETS)[number];
