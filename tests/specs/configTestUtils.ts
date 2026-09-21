import { volViewPage } from '../pageobjects/volview.page';
import { writeManifestToFile } from './utils';
import {
  ONE_CT_SLICE_DICOM,
  PROSTATEX_DATASET,
  PROSTATE_SEGMENT_GROUP,
  type TestDataset,
} from '../datasets';

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

export const openConfigAndDataset = async (
  config: unknown,
  name: string,
  dataset: TestDataset = ONE_CT_SLICE_DICOM
) => {
  const configFileName = `${name}-config.json`;
  await writeManifestToFile(config, configFileName);

  await volViewPage.open(`?urls=[tmp/${dataset.name},tmp/${configFileName}]`);
  await volViewPage.waitForViews();
};
