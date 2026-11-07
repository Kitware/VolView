import { describe, expect, it } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Chunk } from '../../core/streaming/chunk';
import { sliceFromBuffer, sliceFromChunk } from '../thumbnailSource';

describe('color thumbnail sources', () => {
  const colorPixels = () => new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 255]);

  it('shows green and blue pixels from an allocated RGB image', () => {
    const image = vtkImageData.newInstance();
    image.setDimensions(3, 1, 1);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: 3,
        values: colorPixels(),
      })
    );
    expect(Array.from(sliceFromBuffer(image, 0).data)).toEqual([0, 255, 50]);
    image.delete();
  });

  it('shows green and blue pixels before the volume has decoded its slice', async () => {
    const chunk = new Chunk({
      metaLoader: {
        meta: { specificCharacterSet: null, elements: [] },
        load() {},
        stop() {},
      },
      dataLoader: { data: new Blob(['color']), load() {}, stop() {} },
    });
    await chunk.loadMeta();
    const slice = await sliceFromChunk(
      chunk,
      async () => ({
        image: {
          size: [3, 1, 1],
          imageType: { components: 3 },
          data: colorPixels(),
        },
      }),
      new AbortController().signal
    );
    expect(Array.from(slice.data)).toEqual([0, 255, 50]);
    chunk.dispose();
  });
});
