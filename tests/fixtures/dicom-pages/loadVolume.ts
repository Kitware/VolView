import {
  allocateVolume,
  type Volume,
} from '@/src/dicom/core/volume/allocateVolume';
import type { InstanceCollectionUpdate } from '@/src/dicom/core/collections/instanceRegistry';
import { loadVolume } from '@/src/dicom/core/volume/loadVolume';
import { applyVolumeUpdate, toVtkImageData } from '@/src/dicom/vtk/volumeImage';
import { never, runtime } from './shared';

/** Allocates a planned collection and decodes it the way a viewer would. */
export async function loadCollection(
  update: InstanceCollectionUpdate,
  previous?: Volume
) {
  const volume = allocateVolume(update, previous);
  const image = toVtkImageData(volume);
  for await (const loaded of loadVolume(volume, { runtime, signal: never })) {
    if ('error' in loaded) throw loaded.error;
    applyVolumeUpdate(image, loaded);
  }
  return { volume, image };
}
