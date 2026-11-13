import {
  emptyRegistry,
  registerInstances,
  type InstanceCollectionUpdate,
} from '@volview/dicom/core/collections/instanceRegistry';
import type { Instance } from '@volview/dicom/core/instance/readInstance';
import {
  allocateVolume,
  type AllocateVolumeOptions,
  type Volume,
} from '@volview/dicom/core/volume/allocateVolume';
import { loadVolume } from '@volview/dicom/core/volume/loadVolume';
import type { DicomRuntime } from '@volview/dicom/core/runtime/createDicomRuntime';
import {
  applyVolumeUpdate,
  toVtkImageData,
} from '@volview/dicom/vtk/volumeImage';
import { never, runtime as defaultRuntime } from './shared';

type LoadOptions = AllocateVolumeOptions & {
  previous?: Volume;
  runtime?: DicomRuntime;
};

/** Allocates a planned collection and decodes it the way a viewer would. */
export async function loadCollection(
  update: Pick<InstanceCollectionUpdate, 'id' | 'collection' | 'members'>,
  { previous, runtime = defaultRuntime, ...options }: LoadOptions = {}
) {
  const allocation = allocateVolume(update, options, previous);
  if (allocation.kind !== 'volume')
    throw new Error(`Expected a volume, got ${allocation.kind}`);
  const { volume } = allocation;
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
