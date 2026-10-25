import {
  createDicomCollectionRegistry,
  type Chunk,
  type CollectionUpdate,
} from '@volview/dicom/core';
import { VtkDicomImage } from '@volview/dicom/vtk';
import { loader } from './shared';

export async function loadVolume(chunk: Chunk, image?: VtkDicomImage) {
  await chunk.loadMeta();
  const registry = createDicomCollectionRegistry();
  const {
    updates: [{ collection, members }],
  } = await registry.register([chunk]);
  return loadCollection({ collection, members }, image);
}

export async function loadCollection(
  { collection, members }: Pick<CollectionUpdate, 'collection' | 'members'>,
  image = new VtkDicomImage({ readDicomImage: loader.readDicomImage })
) {
  try {
    const finished = new Promise<void>((resolve, reject) => {
      image.addEventListener('status', (status) => {
        if (status === 'complete') resolve();
      });
      image.addEventListener('error', reject);
    });
    await image.setChunks(
      members,
      collection.orientation,
      collection.reconstruction
    );
    image.startLoad();
    await finished;
    return image;
  } catch (error) {
    image.dispose();
    throw error;
  }
}
