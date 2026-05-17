import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';

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

export const PROSTATE_610_LABELMAP_MANIFEST = {
  version: '6.1.0',
  dataSources: [
    {
      id: 0,
      type: 'uri',
      uri: `/tmp/${PROSTATEX_DATASET.name}`,
    },
    {
      id: 1,
      type: 'uri',
      uri: `/tmp/${PROSTATE_SEGMENT_GROUP.name}`,
    },
  ],
  labelMaps: [
    {
      id: 'seg-1',
      dataSourceId: 1,
      metadata: {
        name: 'Prostate Segmentation',
        parentImage: '0',
        segments: {
          order: [1],
          byValue: {
            '1': {
              value: 1,
              name: 'Prostate',
              color: [255, 0, 0, 255],
              visible: true,
            },
          },
        },
      },
    },
  ],
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

export type DatasetResource = {
  url: string;
  name?: string;
};

export const openConfigAndDataset = async (
  config: unknown,
  name: string,
  dataset: DatasetResource = ONE_CT_SLICE_DICOM
) => {
  const configFileName = `${name}-config.json`;
  await writeManifestToFile(config, configFileName);

  await volViewPage.open(
    `?config=[tmp/${configFileName}]&urls=${dataset.url}&names=${
      dataset.name ?? ''
    }`
  );
  await volViewPage.waitForViews();
};
