// Every file the suite fetches from the internet. The runner downloads them
// into the dataset cache before any spec starts, and specs read them from the
// local server at `/tmp/<name>`. CI keys its dataset cache on this file.
//
// Release fixtures and original public DICOM instances are pinned by SHA-256.
const DATASET_RELEASE =
  'https://github.com/Kitware/VolView/releases/download/test-data-1';

// `origin` is where the file was first published.
const DATASETS = {
  JHU_RETINAL_LAYERS: {
    name: 'jhu-retinal-layers.zip',
    origin:
      'https://data.kitware.com/api/v1/file/6ad50668958ec4db1f0d94d7/download',
    url: 'https://data.kitware.com/api/v1/file/6ad50668958ec4db1f0d94d7/download',
    sha256: 'c9b3547e46c79f9739303dc5256bebb9630aef8f370f9d138fddfb60c75f689f',
  },
  // MIT, copyright 2020 Theis Lab. An anonymized example from DeepRT.
  RETINAL_OCT_DICOM: {
    name: 'retinal-oct.dcm',
    origin:
      'https://raw.githubusercontent.com/theislab/DeepRT/be86ac601294866d0c3f1d924418d8fee41ead37/thickness_map_calculation/data/256692_R_20160524/1.3.6.1.4.1.33437.10.4.4089432.13108567473.25811.4.1.dcm',
    url: 'https://raw.githubusercontent.com/theislab/DeepRT/be86ac601294866d0c3f1d924418d8fee41ead37/thickness_map_calculation/data/256692_R_20160524/1.3.6.1.4.1.33437.10.4.4089432.13108567473.25811.4.1.dcm',
    sha256: 'f82badd35ee5691133a0d25c34568cedb0bd17575bb75b8812d61c03f13a4992',
  },
  ONE_CT_SLICE_DICOM: {
    name: 'CT000085.dcm',
    url: `${DATASET_RELEASE}/CT000085.dcm`,
    origin:
      'https://data.kitware.com/api/v1/file/6566aa81c5a2b36857ad1783/download',
    sha256: '8c9c3477a3bcf54477f7705c9f60ec2473699b8ac93a11f00332873c1dde6b9b',
  },
  MINIMAL_DICOM: {
    name: 'minimal.dcm',
    url: `${DATASET_RELEASE}/minimal.dcm`,
    origin:
      'https://data.kitware.com/api/v1/file/68e9807dbf0f869935e36481/download',
    sha256: 'c0d05d47b16cbc2e1a913c5b1dc1b5c982eb8499f7674c2e5933a81d5ab878a1',
  },
  MINIMAL_501_SESSION: {
    name: 'minimal-501-session.volview.zip',
    url: `${DATASET_RELEASE}/minimal-501-session.volview.zip`,
    origin:
      'https://data.kitware.com/api/v1/file/693077d880eaefe49a4abb88/download',
    sha256: 'e2dded0c7bcabae6611e4bcc7e0170e2902640624de60043aa6d363630844d7d',
  },
  PROSTATEX_DATASET: {
    name: 'prostate.zip',
    url: `${DATASET_RELEASE}/prostate.zip`,
    origin:
      'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
    sha256: '2db4738cc063f80eaaeffd52b83271dca1e3543518a54240c01e5ba2d5629dd1',
  },
  PROSTATE_SEGMENT_GROUP: {
    name: 'prostate-total.seg.nii.gz',
    url: `${DATASET_RELEASE}/prostate-total.seg.nii.gz`,
    origin:
      'https://data.kitware.com/api/v1/file/692f13ed80eaefe49a4abb72/download',
    sha256: '30704eab70795d242f529c63c467867f7ac5256a8bf50af28a272bc6c866f394',
  },
  MRA_HEAD_NECK_DATASET: {
    name: 'MRA-Head_and_Neck.zip',
    url: `${DATASET_RELEASE}/MRA-Head_and_Neck.zip`,
    origin:
      'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
    sha256: 'd1d692f449e94294f1204040c43aa313b84fb4d6be9eb4c8558f78435126f875',
  },
  FETUS_DATASET: {
    name: 'fetus.zip',
    url: `${DATASET_RELEASE}/fetus.zip`,
    origin:
      'https://data.kitware.com/api/v1/item/635679c311dab8142820a4f4/download',
    sha256: '3cf89e3d24dfaaea61b006e797df6976a8b2e94a63637e34e16c3608d6e19464',
  },
  // Multiframe ultrasound DICOM from pydicom public test data.
  // SequenceOfUltrasoundRegions: PhysicalDeltaX/Y = 0.05104970559 cm/pixel
  // (unit code 3 = cm), so with US spacing fix the VTK spacing is ~0.5105 mm.
  US_MULTIFRAME_DICOM: {
    name: 'US_multiframe_30frames.dcm',
    url: `${DATASET_RELEASE}/US_multiframe_30frames.dcm`,
    origin:
      'https://data.kitware.com/api/v1/file/69e1630646ef98a20f563020/download',
    sha256: '6fa3a087d3c631b43216a8abec8aac8d2d73751c5bf5885708d1150b09283f72',
  },
  // 8-frame echocardiogram from the BSD-licensed GDCM test corpus. Native
  // Explicit VR LE, MONOCHROME2, retired Ultrasound Multi-frame SOP UID.
  CINE_US_DATASET: {
    name: 'US-MONO2-8-8x-echo.dcm',
    url: `${DATASET_RELEASE}/US-MONO2-8-8x-echo.dcm`,
    origin:
      'https://sourceforge.net/p/gdcm/gdcmdata/ci/master/tree/US-MONO2-8-8x-execho.dcm?format=raw',
    sha256: '7d3f54806d0315c6cfc8b7371649a242b5ef8f31e0d20221971dd8087f2ff1ea',
  },
  // 120-frame RGB ultrasound cine encoded as JPEG Baseline. Exercises the async
  // browser JPEG decode path used by common compressed ultrasound clips.
  COLOR3D_JPEG_BASELINE_DICOM: {
    name: 'color3d_jpeg_baseline.dcm',
    url: `${DATASET_RELEASE}/color3d_jpeg_baseline.dcm`,
    origin:
      'https://raw.githubusercontent.com/pydicom/pydicom-data/master/data_store/data/color3d_jpeg_baseline.dcm',
    sha256: 'c8798b8abf8ae0a18e8c9952e7c7f75f3cc8465234b1b63f9e3ba3bebb9d5625',
  },
  CT_ELECTRODES: {
    name: 'CT_Electrodes.nii.gz',
    url: `${DATASET_RELEASE}/CT_Electrodes.nii.gz`,
    origin:
      'https://raw.githubusercontent.com/neurolabusc/niivue-images/main/CT_Electrodes.nii.gz',
    sha256: '0566942708ff451458d0fdb1f61c4611187bb5cc0efa516c8500f1ff3c142e57',
  },
} as const;

export const {
  JHU_RETINAL_LAYERS,
  RETINAL_OCT_DICOM,
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

export const PET_CT_DICOM_DATASETS = [
  {
    name: 'PET-CT-PT-01.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.125971577518855152164687925479',
    sha256: '082cc2a92409d26dcd465ca37dcb55182f526fa94f0d66299c93196f0dd2b130',
  },
  {
    name: 'PET-CT-PT-02.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.164470072637482892742730606415',
    sha256: '7fc5a40cc7645c64c91df14008e27c8f20f6b613af8f888125d72c6ae6f153d6',
  },
  {
    name: 'PET-CT-PT-03.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.645656839545863315258382059304',
    sha256: 'b4922f66ed2d02e1783c32d23e3bd8aa73cc30f648784de91316890c1a8faaf6',
  },
  {
    name: 'PET-CT-PT-04.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.171033599854331402388163035916',
    sha256: 'ae96aa74535276c86e9e6f06be540b446f349d58e376cd6812832bbb183fed0b',
  },
  {
    name: 'PET-CT-PT-05.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.757229251338810950547930294076',
    sha256: '71d7ea70e1527dcaac130ec4794748710961d0d18b11dc8a0dda3d96c7e1ddea',
  },
  {
    name: 'PET-CT-PT-06.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.290313076131916328810257384513',
    sha256: '4c9f3fac5d2710d72c46ed63f97aed8052245380967efa3f1f4ce72aeb488fa7',
  },
  {
    name: 'PET-CT-PT-07.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.167034157012705076112347098246',
    sha256: 'c5398c842bb35f7c7b7d77398d2246003b4565474961c622820545ab1a42d7dc',
  },
  {
    name: 'PET-CT-PT-08.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.305525101475115108798705213666',
    sha256: '65115e0a3335074976e2178e52e5036bfe4201d3b315a79f733cb470729c220d',
  },
  {
    name: 'PET-CT-PT-09.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.180547818912813778100247492512',
    sha256: '8e0316240d5e8cc3c7e0913b4abb892be1be5879b5cc3f0379a205fd286ca17b',
  },
  {
    name: 'PET-CT-PT-10.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.316521143696464534574699049839&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.190211187176681563808826571096',
    sha256: 'fb424c9c3670d0f0374361ecb16bf342e27cdfcf8be0aead1e4629ea7a2e7928',
  },
  {
    name: 'PET-CT-CT-01.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.330442471593744252750634668562',
    sha256: '262fc85a0a05c57ec96451baf8a1b64f3287d5d6efdf5e4d9e67983e20e59fe2',
  },
  {
    name: 'PET-CT-CT-02.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.787146087385319992976365569088',
    sha256: 'c348f6f8d899ce9e02a4b2fc3f93743491df1a04c99f65c1c77ab1c8baec8cb7',
  },
  {
    name: 'PET-CT-CT-03.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.754367593034585495537680981967',
    sha256: '4935a37d77059028d175a38c515e52beb2e90d0971c9b495ab956433c8e7fa18',
  },
  {
    name: 'PET-CT-CT-04.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.268694914226381205284654198517',
    sha256: '27cff9c1bd6d1fc6543bb8d2a009e232c4f39b6aa333b9d3ce39d7cdeddf0cc3',
  },
  {
    name: 'PET-CT-CT-05.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.273002091516249828143197374115',
    sha256: '038be9136459b5d9d5dbd44b7d35394012a0415f5ed09b2ba46ca34aef1c1f96',
  },
  {
    name: 'PET-CT-CT-06.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.251520880093056497198942071424',
    sha256: 'feceb609cda89e382459a1c6884e5737e5f00b378de19c33e3f9838474f418bd',
  },
  {
    name: 'PET-CT-CT-07.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.254151550624375545322457061626',
    sha256: 'a416fb025436c0d0bcdedb9e36b51a4ac744ac332b83ce8c94da7b459188e39b',
  },
  {
    name: 'PET-CT-CT-08.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.477776731601464757864806040291',
    sha256: '6b8db167b9ddbf9194d9935b94092668d2b7eb6c576dce5cc3f96046046fb6fc',
  },
  {
    name: 'PET-CT-CT-09.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.831869199671510110705249657284',
    sha256: '31df0464f111f0cccd1cba25f2e014f88375de44bc0ba7ead844a015508f5f43',
  },
  {
    name: 'PET-CT-CT-10.dcm',
    url: 'https://services.cancerimagingarchive.net/nbia-api/services/v1/getSingleImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.114189455733462211540942355885&SOPInstanceUID=1.3.6.1.4.1.14519.5.2.1.6655.2359.243468898389109491372438016818',
    sha256: 'c2470a67fd601d7e36130bebd51e8e71b9f6fad9832ea6b79f504309f2fee984',
  },
];

// Everything declared above is downloaded.
export const TEST_DATASETS = [
  ...Object.values(DATASETS),
  ...PET_CT_DICOM_DATASETS,
];

export type TestDataset = (typeof TEST_DATASETS)[number];
