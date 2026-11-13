import {
  allocateVolume,
  emptyRegistry,
  loadVolume,
  registerInstances,
  type AllocateVolumeOptions,
  type DicomRuntime,
  type Instance,
  type InstanceCollectionUpdate,
  type Volume,
} from '@/packages/dicom/core';
import { applyVolumeUpdate, toVtkImageData } from '@/packages/dicom/vtk';
import { never, runtime as defaultRuntime } from './shared';

type LoadOptions = AllocateVolumeOptions & {
  previous?: Volume;
  runtime?: DicomRuntime;
};

/** Allocates a planned collection and decodes it the way a viewer would. */
export async function loadCollection(
  update: InstanceCollectionUpdate,
  { previous, runtime = defaultRuntime, ...options }: LoadOptions = {}
) {
  if (update.kind !== 'image')
    throw new Error(`Expected a volume, got ${update.kind}`);
  const volume = allocateVolume(update, options, previous);
  const image = toVtkImageData(volume);
  for await (const loaded of loadVolume(volume, { runtime, signal: never })) {
    if ('error' in loaded) throw loaded.error;
    applyVolumeUpdate(image, loaded);
  }
  return { volume, image };
}

export function loadInstanceVolume(instance: Instance, options?: LoadOptions) {
  const [update] = registerInstances(emptyRegistry, [instance]).updates;
  return loadCollection(update, options);
}
