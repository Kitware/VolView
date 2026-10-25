import { Chunk } from '../core/index';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { TypedArray } from '@kitware/vtk.js/types';
import type { VtkDicomImageInit } from './types';
import { sliceToThumbnail } from './thumbnail';
import { untilAborted } from './lifetime';

const { fastComputeRange } = vtkDataArray;
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
  await untilAborted(chunk.loadData(), signal);
  const loaded = chunk;
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
