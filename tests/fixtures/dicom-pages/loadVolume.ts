import {
  allocateVolume,
  type Volume,
} from '@/src/dicom/core/volume/allocateVolume';
import {
  emptyRegistry,
  registerInstances,
  type InstanceCollectionUpdate,
} from '@/src/dicom/core/collections/instanceRegistry';
import { getDatasetModality } from '@/src/dicom/core/metadata/datasetAccess';
import { loadVolume } from '@/src/dicom/core/volume/loadVolume';
import type { Instance } from '@/src/dicom/core/instance/readInstance';
import { applyVolumeUpdate, toVtkImageData } from '@/src/dicom/vtk/volumeImage';
import { never, runtime } from './shared';

/** Allocates a planned collection and decodes it the way a viewer would. */
export async function loadCollection(
  update: InstanceCollectionUpdate,
  previous?: Volume
) {
  if (getDatasetModality(update.members[0].dataset) === 'SEG')
    throw new Error('Expected a volume, got a segmentation');
  const volume = allocateVolume(update, previous);
  const image = toVtkImageData(volume);
  for await (const loaded of loadVolume(volume, { runtime, signal: never })) {
    if ('error' in loaded) throw loaded.error;
    applyVolumeUpdate(image, loaded);
  }
  return { volume, image };
}

export async function loadInstanceVolume(instance: Instance) {
  const [update] = registerInstances(emptyRegistry, [instance]).updates;
  return { update, ...(await loadCollection(update)) };
}
