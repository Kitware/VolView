import { getDisplayName, useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageStore } from '@/src/store/datasets-images';
import { Maybe } from '@/src/types';

export type DataSelection = string;

export const selectionEquals = (a: DataSelection, b: DataSelection) => a === b;

export const isDicomImage = (imageID: Maybe<string>) => {
  if (!imageID) return false;
  const store = useDICOMStore();
  return imageID in store.volumeInfo;
};

export const isRegularImage = (imageID: Maybe<string>) => {
  if (!imageID) return false;
  return !isDicomImage(imageID);
};

export const getImage = (imageID: string) => {
  return useImageStore().dataIndex[imageID];
};

const getImageName = (imageID: string) => {
  return useImageStore().metadata[imageID].name;
};

export const getSelectionName = (selection: string) => {
  if (isDicomImage(selection)) {
    return getDisplayName(useDICOMStore().volumeInfo[selection]);
  }
  return getImageName(selection);
};
