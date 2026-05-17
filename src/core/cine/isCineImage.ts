import { Maybe } from '@/src/types';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import type DicomCineImage from './DicomCineImage';

export function isCineImage(imageID: Maybe<string>): boolean {
  if (!imageID) return false;
  return useDICOMStore().volumeInfo[imageID]?.kind === 'cine';
}

export function getCineImage(imageID: Maybe<string>): DicomCineImage | null {
  if (!isCineImage(imageID)) return null;
  return (useImageCacheStore().imageById[imageID!] as DicomCineImage) ?? null;
}
