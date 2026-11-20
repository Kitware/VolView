import {
  allocateVolume,
  type Volume,
} from '@/packages/dicom/core/volume/allocateVolume';
import {
  emptyRegistry,
  registerInstances,
  type InstanceCollectionUpdate,
} from '@/packages/dicom/core/collections/instanceRegistry';
import { getDatasetModality } from '@/packages/dicom/core/metadata/datasetAccess';
import { loadVolume } from '@/packages/dicom/core/volume/loadVolume';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import {
  applyVolumeUpdate,
  toVtkImageData,
} from '@/packages/dicom/vtk/volumeImage';
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

export function loadInstanceVolume(instance: Instance) {
  const [update] = registerInstances(emptyRegistry, [instance]).updates;
  return loadCollection(update);
}
