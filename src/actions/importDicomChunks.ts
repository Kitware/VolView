import { Chunk } from '@/src/core/streaming/chunk';
import DicomChunkImage from '@/src/core/streaming/dicomChunkImage';
import { splitAndSort } from '@/src/io/dicom';
import useChunkStore from '@/src/store/chunks';

export async function importDicomChunks(chunks: Chunk[]) {
  // split into groups
  const chunksByVolume = await splitAndSort(chunks, (chunk) => chunk.metaBlob!);

  // add to matching DICOM images
  const chunkStore = useChunkStore();
  await Promise.all(
    Object.entries(chunksByVolume).map(async ([id, groupedChunks]) => {
      const image =
        (chunkStore.chunkImageById[id] as DicomChunkImage) ??
        new DicomChunkImage();
      chunkStore.chunkImageById[id] = image;

      await image.addChunks(groupedChunks);

      // TODO(fli) REMOVE to be on-demand when the dataset is being viewed
      image.startLoad();
    })
  );

  return Object.keys(chunksByVolume);
}
