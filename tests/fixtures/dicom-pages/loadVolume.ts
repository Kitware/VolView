import {
  allocateVolume,
  type AllocateVolumeOptions,
  type Volume,
} from '@/packages/dicom/core/volume/allocateVolume';
import {
  emptyRegistry,
  registerInstances,
  type InstanceCollectionUpdate,
} from '@/packages/dicom/core/collections/instanceRegistry';
import { loadVolume } from '@/packages/dicom/core/volume/loadVolume';
import type { DicomRuntime } from '@/packages/dicom/core/runtime/createDicomRuntime';
import type { Instance } from '@/packages/dicom/core/instance/readInstance';
import {
  applyVolumeUpdate,
  toVtkImageData,
} from '@/packages/dicom/vtk/volumeImage';
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
