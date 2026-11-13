import { describe, expect, it } from 'vitest';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { createDicomRuntime } from '../../core/runtime/createDicomRuntime';
import { loadVolume } from '../../core/volume/loadVolume';
import {
  allocated,
  pixelSlice,
  valueDecoder,
} from '../../core/volume/__tests__/volumeFixture';
import type { Volume } from '../../core/volume/allocateVolume';
import {
  applyVolumeUpdate,
  sliceThumbnail,
  toVtkImageData,
} from '../volumeImage';

const stack = (values: number[], previous?: Volume) =>
  allocated(
    values.map((z) => pixelSlice(z)),
    previous
  );

const rangeOf = (image: vtkImageData) => [
  ...image.getPointData().getScalars().getRange(0),
];

/** Loads one slice at a time, recording the scalar range after each update. */
async function loadRanges(volume: Volume) {
  const image = toVtkImageData(volume);
  const runtime = createDicomRuntime({
    decoder: valueDecoder(),
    decodeConcurrency: 1,
  });
  const ranges: number[][] = [];
  for await (const update of loadVolume(volume, {
    runtime,
    signal: new AbortController().signal,
    readAhead: 1,
  })) {
    applyVolumeUpdate(image, update);
    ranges.push(rangeOf(image));
  }
  runtime.dispose();
  return { image, ranges };
}

describe('vtk volume adapter', () => {
  it('wraps the volume buffer and geometry without copying', () => {
    const volume = stack([0, 1, 2]);

    const image = toVtkImageData(volume);

    expect(image.getPointData().getScalars().getData()).toBe(volume.data);
    expect(image.getDimensions()).toEqual([4, 4, 3]);
    expect(image.getSpacing()).toEqual([0.5, 0.5, 1]);
    expect(image.getOrigin()).toEqual([0, 0, 0]);
    expect(Array.from(image.getDirection())).toEqual([...volume.direction]);
    image.delete();
  });

  it('starts from a placeholder range until a slice decodes, then widens it', async () => {
    const volume = stack([0, 1, 2, 3, 4]);
    const empty = toVtkImageData(volume);
    expect(rangeOf(empty)).toEqual([0, 255]);
    empty.delete();

    const { image, ranges } = await loadRanges(volume);

    expect(ranges).toEqual([
      [2, 2],
      [0, 2],
      [0, 4],
      [0, 4],
      [0, 4],
    ]);
    image.delete();
  });

  it('replaces the placeholder even when every slice loaded before the first update applies', async () => {
    const volume = stack([300, 301, 302]);
    const image = toVtkImageData(volume);
    const runtime = createDicomRuntime({ decoder: valueDecoder() });
    const updates = [];
    for await (const update of loadVolume(volume, {
      runtime,
      signal: new AbortController().signal,
    }))
      updates.push(update);
    runtime.dispose();

    updates.forEach((update) => applyVolumeUpdate(image, update));

    expect(rangeOf(image)).toEqual([300, 302]);
    image.delete();
  });

  it('starts a grown volume from the range of the slices it carried over', async () => {
    const [one, three] = [pixelSlice(1), pixelSlice(3)];
    const sparse = allocated([one, three]);
    (await loadRanges(sparse)).image.delete();

    const image = toVtkImageData(
      allocated([one, pixelSlice(2), three], sparse)
    );

    expect(rangeOf(image)).toEqual([1, 3]);
    image.delete();
  });

  it('shows green and blue pixels of an RGB slice as luminance', () => {
    const image = vtkImageData.newInstance();
    image.setDimensions(3, 1, 1);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: 3,
        values: new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 255]),
      })
    );

    expect(Array.from(sliceThumbnail(image, 0).data)).toEqual([0, 255, 50]);
    image.delete();
  });
});
