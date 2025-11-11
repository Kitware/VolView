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

export const ANOTHER_DICOM = {
  url: 'https://data.kitware.com/api/v1/file/655d42a694ef39bf0a4a8bb3/download',
  name: '1-001.dcm',
} as const;

export const PROSTATEX_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download',
  name: 'prostate.zip',
} as const;

export const MRA_HEAD_NECK_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/6352a2b311dab8142820a33b/download',
  name: 'MRA-Head_and_Neck.zip',
} as const;

export const FETUS_DATASET = {
  url: 'https://data.kitware.com/api/v1/item/635679c311dab8142820a4f4/download',
  name: 'fetus.zip',
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
