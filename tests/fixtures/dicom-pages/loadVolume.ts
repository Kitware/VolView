import {
  allocateVolume,
  emptyRegistry,
  loadVolume,
  registerInstances,
  type Instance,
  type InstanceCollectionUpdate,
  type Volume,
} from '@/packages/dicom/core';
import { applyVolumeUpdate, toVtkImageData } from '@/packages/dicom/vtk';
import { never, runtime } from './shared';

/** Allocates a planned collection and decodes it the way a viewer would. */
export async function loadCollection(
  update: InstanceCollectionUpdate,
  previous?: Volume
) {
  if (update.kind !== 'image')
    throw new Error(`Expected a volume, got ${update.kind}`);
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
