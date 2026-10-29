import { afterEach, describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { measureOccupiedDepth } from '@/src/segmentation/measurements/occupiedDepth';
import { getSourceValidity } from '../sourceValidity';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((release) => release()));

function source() {
  const values = new Float32Array([0, -1, 1, 5, 5, 5, 0, 1, -1, 2, 10, 20]);
  const image = vtkImageData.newInstance();
  image.setDimensions([2, 3, 2]);
  const scalars = vtkDataArray.newInstance({ values, numberOfComponents: 1 });
  image.getPointData().setScalars(scalars);
  cleanup.push(() => {
    image.delete();
    scalars.delete();
  });
  return { image, scalars, values };
}

const padding = [{ firstFrame: 1, lastFrame: 1, min: -1, max: 1 }];

function measured(
  image: vtkImageData,
  validity: ReturnType<typeof getSourceValidity>
) {
  return measureOccupiedDepth({
    dimensions: image.getDimensions(),
    axis: 1,
    first: 0,
    last: 2,
    validity,
    mask: {
      values: new Uint8Array(12).fill(1),
      dimensions: [2, 3, 2],
      extent: [0, 1, 0, 2, 0, 1],
    },
  });
}

describe('declared padding support for occupied-depth measurement', () => {
  it('leaves every unmarked source voxel valid without allocating a support array', () => {
    const { image } = source();
    const validity = getSourceValidity(image, [], image.getExtent());
    expect(validity).toBeUndefined();
    const result = measured(image, validity);
    expect(Array.from(result.counts)).toEqual([3, 3, 3, 3]);
    expect(Array.from(result.known)).toEqual([1, 1, 1, 1]);
  });

  it('applies inclusive padding only in its declared frames and keeps genuine zero data', () => {
    const { image } = source();
    const result = measured(
      image,
      getSourceValidity(image, padding, image.getExtent())
    );
    expect(Array.from(result.counts)).toEqual([3, 3, 0, 0]);
    expect(Array.from(result.known)).toEqual([1, 1, 0, 0]);
  });

  it('allocates only the selected crop and maps its source support back to displayed columns', () => {
    const { image } = source();
    const validity = getSourceValidity(image, padding, [0, 1, 1, 1, 1, 1]);
    expect(Array.from(validity!.values)).toEqual([0, 1]);
    const result = measureOccupiedDepth({
      dimensions: image.getDimensions(),
      axis: 1,
      first: 1,
      last: 1,
      validity,
      mask: {
        values: new Uint8Array(4).fill(1),
        dimensions: [2, 2, 1],
        extent: [0, 1, 1, 2, 1, 1],
      },
    });
    expect(Array.from(result.counts)).toEqual([0, 0, 0, 1]);
    expect(Array.from(result.known)).toEqual([1, 1, 0, 1]);
    expect(
      getSourceValidity(image, padding, [0, 1, 3, 2, 1, 1])
    ).toBeUndefined();
  });

  it('refreshes support after source values or padding declarations change', () => {
    const { image, scalars, values } = source();
    getSourceValidity(image, padding, image.getExtent());
    values.set([2, 2, 2], 6);
    scalars.modified();
    const edited = measured(
      image,
      getSourceValidity(image, padding, image.getExtent())
    );
    expect(Array.from(edited.counts)).toEqual([3, 3, 3, 3]);
    expect(Array.from(edited.known)).toEqual([1, 1, 1, 1]);
    const redeclared = measured(
      image,
      getSourceValidity(
        image,
        [{ ...padding[0], min: 2, max: 2 }],
        image.getExtent()
      )
    );
    expect(Array.from(redeclared.known)).toEqual([1, 1, 0, 0]);
  });
});
