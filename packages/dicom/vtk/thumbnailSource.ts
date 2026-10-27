import { Chunk, ChunkState } from '../core/index';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { TypedArray } from '@kitware/vtk.js/types';
import type { VtkDicomImageInit } from './types';
import { sliceToThumbnail } from './thumbnail';
import { untilAborted } from './lifetime';

const { fastComputeRange } = vtkDataArray;
const ensureError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

/**
 * The chunk once its bytes are in, or the error that means they never will
 * be. A chunk that errored settles back to holding metadata only, so waiting
 * on the loaded state alone would wait forever.
 */
const loadedChunk = (chunk: Chunk, signal: AbortSignal) =>
  new Promise<Chunk>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    if (chunk.state === ChunkState.Loaded) {
      resolve(chunk);
      return;
    }
    const stopWatching = chunk.watchForState(ChunkState.Loaded, () => {
      stopListening();
      resolve(chunk);
    });
    const stopListening = () => {
      stopWatching();
      stopOnError();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      stopListening();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const stopOnError = chunk.addEventListener('error', (err) => {
      stopListening();
      reject(ensureError(err));
    });
  });

export function sliceFromBuffer(image: vtkImageData, slot: number) {
  const scalars = image.getPointData().getScalars();
  const components = scalars.getNumberOfComponents();
  const [width, height] = image.getDimensions();
  const samplesPerSlice = width * height * components;
  const data = scalars.getData();

  return sliceToThumbnail({
    data: data.subarray(slot * samplesPerSlice, (slot + 1) * samplesPerSlice),
    width,
    height,
    components,
    // The thumbnail reads component 0, so it windows on that component's
    // range, not the multi-component vector magnitude range.
    range: scalars.getRange(0) as [number, number],
  });
}

// Before a chunk's slot holds pixels, its own bytes are the only source.
export async function sliceFromChunk(
  chunk: Chunk,
  read: VtkDicomImageInit['readDicomImage'],
  signal: AbortSignal
) {
  const loaded = await loadedChunk(chunk, signal);
  if (!loaded.dataBlob) throw new Error('No chunk data');

  const { image } = await untilAborted(
    read(
      new File([loaded.dataBlob], 'thumbnail.dcm'),
      loaded.metadata ?? undefined
    ),
    signal
  );
  if (!image.data) throw new Error('No data read from chunk');

  const [width, height] = image.size;
  const components = image.imageType.components;
  const data = image.data as TypedArray;
  const { min, max } = fastComputeRange(data, 0, components);

  return sliceToThumbnail({
    data,
    width,
    height,
    components,
    range: [min, max],
  });
}
