import { getDisplayName, useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageStore } from '@/src/store/datasets-images';
import { useErrorMessage } from '@/src/composables/useErrorMessage';

export const makeDICOMSelection = (volumeKey: string) =>
  ({
    type: 'dicom',
    volumeKey,
  } as const);

export type DICOMSelection = ReturnType<typeof makeDICOMSelection>;

export const makeImageSelection = (imageID: string) =>
  ({
    type: 'image',
    dataID: imageID,
  } as const);

export type ImageSelection = ReturnType<typeof makeImageSelection>;

export type DataSelection = DICOMSelection | ImageSelection;

export const getImageID = (selection: DataSelection) => {
  if (selection.type === 'image') return selection.dataID;
  if (selection.type === 'dicom') {
    // possibly undefined because image may not have been made yet
    return useDICOMStore().volumeToImageID[selection.volumeKey];
  }

  const _exhaustiveCheck: never = selection;
  throw new Error(`invalid selection type ${_exhaustiveCheck}`);
};

export const getImage = async (selection: DataSelection) => {
  const images = useImageStore();
  const dicoms = useDICOMStore();
  if (selection.type === 'dicom') {
    // ensure image data exists
    await useErrorMessage('Failed to build volume', () =>
      dicoms.buildVolume(selection.volumeKey)
    );
    return images.dataIndex[getImageID(selection)!];
  }
  // just an image that should be in dataIndex
  return images.dataIndex[selection.dataID];
};

// Converts imageID to VolumeKey if exists, else return input imageID
export const getDataID = (imageID: string) => {
  const dicomStore = useDICOMStore();
  return dicomStore.imageIDToVolumeKey[imageID] ?? imageID;
};

// @param id - VolumeKey or ImageID
export const getDataSelection = (id: string) => {
  const dicomStore = useDICOMStore();
  const volumeKey =
    dicomStore.imageIDToVolumeKey[id] ??
    (id in dicomStore.volumeInfo ? id : undefined);
  if (volumeKey) {
    return makeDICOMSelection(volumeKey);
  }
  return makeImageSelection(id);
};

// Pass VolumeKey or ImageID and get ImageID
export const findImageID = (dataID: string) => {
  const dicomStore = useDICOMStore();
  return dicomStore.volumeToImageID[dataID] ?? dataID;
};

export function selectionEquals(s1: DataSelection, s2: DataSelection) {
  if (s1.type === 'dicom' && s2.type === 'dicom') {
    return s1.volumeKey === s2.volumeKey;
  }
  if (s1.type === 'image' && s2.type === 'image') {
    return s1.dataID === s2.dataID;
  }
  return false;
}

const getImageName = (imageID: string) => {
  return useImageStore().metadata[imageID].name;
};

export const getSelectionName = (selection: DataSelection) => {
  if (selection.type === 'image') return getImageName(selection.dataID);
  if (selection.type === 'dicom') {
    const imageID = getImageID(selection);
    if (imageID) return getImageName(imageID);
    return getDisplayName(useDICOMStore().volumeInfo[selection.volumeKey]);
  }
  const _exhaustiveCheck: never = selection;
  throw new Error(`invalid selection type ${_exhaustiveCheck}`);
};
