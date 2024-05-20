import { getDisplayName, useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageStore } from '@/src/store/datasets-images';
import { useErrorMessage } from '@/src/composables/useErrorMessage';
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

export const getImage = async (imageID: string) => {
  const images = useImageStore();
  const dicoms = useDICOMStore();
  if (isDicomImage(imageID)) {
    // ensure image data exists
    await useErrorMessage('Failed to build volume', () =>
      dicoms.buildVolume(imageID)
    );
  }
  return images.dataIndex[imageID];
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
